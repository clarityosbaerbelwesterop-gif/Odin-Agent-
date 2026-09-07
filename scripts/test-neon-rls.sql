-- Runs with the actual non-owner application role; every synthetic row is rolled back.
SET LOCAL ROLE odin_runtime;
DO $test$
DECLARE a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); mission uuid:=gen_random_uuid(); owned_mission uuid:=gen_random_uuid(); n int; tab text;
BEGIN
  IF current_user <> 'odin_runtime' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Test did not use an RLS-constrained role';
  END IF;
  BEGIN
    PERFORM set_config('odin.user_id','rls-test-a',true);
    INSERT INTO odin_api.conversations(id,title) VALUES(a,'User A');
    INSERT INTO odin_api.mission_streams(id) VALUES(owned_mission);
    INSERT INTO odin_api.turns(id,conversation_id,request_key,request_hash,data,data_hash)
      VALUES(owned_mission,a,'owned',repeat('a',64),'{}',repeat('a',64));
    INSERT INTO odin_api.events(conversation_id,turn_id,type,data,data_hash)
      VALUES(a,owned_mission,'activity','{}',repeat('a',64));
    INSERT INTO odin_api.checkpoints(turn_id,data,data_hash) VALUES(owned_mission,'{}',repeat('a',64));
    INSERT INTO odin_api.workspace_files(conversation_id,path,content,sha) VALUES(a,'index.html','hello',repeat('a',64));
    INSERT INTO odin_api.leases(resource,token,expires_at) VALUES('rls-test',gen_random_uuid(),now()+interval '1 minute');
    INSERT INTO odin_api.rate_limits(scope,hits,expires_at) VALUES('rls-test',1,now()+interval '1 minute');
    SELECT count(*) INTO n FROM odin_api.conversations WHERE id=a;
    IF n<>1 THEN RAISE EXCEPTION 'Own row is not readable'; END IF;
    PERFORM set_config('odin.user_id','rls-test-b',true);
    FOREACH tab IN ARRAY ARRAY['conversations','mission_streams','turns','events','checkpoints','workspace_files','leases','rate_limits'] LOOP
      EXECUTE format('SELECT count(*) FROM odin_api.%I WHERE owner_id=%L',tab,'rls-test-a') INTO n;
      IF n<>0 THEN RAISE EXCEPTION 'Cross-user SELECT leaked from %',tab; END IF;
      EXECUTE format('UPDATE odin_api.%I SET owner_id=owner_id WHERE owner_id=%L',tab,'rls-test-a');
      GET DIAGNOSTICS n=ROW_COUNT;
      IF n<>0 THEN RAISE EXCEPTION 'Cross-user UPDATE reached %',tab; END IF;
      EXECUTE format('DELETE FROM odin_api.%I WHERE owner_id=%L',tab,'rls-test-a');
      GET DIAGNOSTICS n=ROW_COUNT;
      IF n<>0 THEN RAISE EXCEPTION 'Cross-user DELETE reached %',tab; END IF;
    END LOOP;
    SELECT count(*) INTO n FROM odin_api.conversations WHERE id=a;
    IF n<>0 THEN RAISE EXCEPTION 'Cross-user SELECT leaked'; END IF;
    UPDATE odin_api.conversations SET title='stolen' WHERE id=a;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>0 THEN RAISE EXCEPTION 'Cross-user UPDATE allowed'; END IF;
    DELETE FROM odin_api.conversations WHERE id=a;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>0 THEN RAISE EXCEPTION 'Cross-user DELETE allowed'; END IF;
    BEGIN
      INSERT INTO odin_api.conversations(owner_id,id,title) VALUES('rls-test-a',b,'forged owner');
      RAISE EXCEPTION 'Owner forgery allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    INSERT INTO odin_api.conversations(id,title) VALUES(b,'User B');
    BEGIN
      UPDATE odin_api.conversations SET owner_id='rls-test-a' WHERE id=b;
      RAISE EXCEPTION 'Owner reassignment allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    INSERT INTO odin_api.mission_streams(id) VALUES(mission);
    BEGIN
      INSERT INTO odin_api.turns(id,conversation_id,request_key,request_hash,data,data_hash)
      VALUES(mission,a,'cross-child',repeat('a',64),'{}',repeat('a',64));
      RAISE EXCEPTION 'Cross-user child relationship allowed';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    PERFORM set_config('odin.user_id','',true);
    SELECT count(*) INTO n FROM odin_api.conversations WHERE id IN(a,b);
    IF n<>0 THEN RAISE EXCEPTION 'Missing identity leaked rows'; END IF;
    BEGIN
      INSERT INTO odin_api.conversations(id,title) VALUES(gen_random_uuid(),'anonymous');
      RAISE EXCEPTION 'Missing identity allowed write';
    EXCEPTION WHEN insufficient_privilege OR not_null_violation THEN NULL; END;
    RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Roll back test fixtures';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
END $test$;
SELECT current_user AS tested_role, 'PASS' AS isolation,
  (SELECT count(*) FROM pg_tables WHERE schemaname='odin_api' AND rowsecurity) AS protected_tables;
