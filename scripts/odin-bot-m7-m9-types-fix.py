from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, found {count}")
    target.write_text(text.replace(old, new, 1))


replace_once(
    "src/chat/github-delivery.ts",
    '''    const existing = await this.#api(`/pulls?${query.toString()}`, { signal: input.signal });''',
    '''    const existing = await this.#api(
      `/pulls?${query.toString()}`,
      input.signal ? { signal: input.signal } : {},
    );''',
)
replace_once(
    "src/chat/github-delivery.ts",
    '''      signal: input.signal,
    });
    return normalizePullRequest(created, branch, this.baseBranch);''',
    '''      ...(input.signal ? { signal: input.signal } : {}),
    });
    return normalizePullRequest(created, branch, this.baseBranch);''',
)
replace_once(
    "src/chat/github-delivery.ts",
    '''    const pull = await this.#api(`/pulls/${number}`, { signal });''',
    '''    const pull = await this.#api(`/pulls/${number}`, signal ? { signal } : {});''',
)
replace_once(
    "src/chat/hosted.ts",
    '''      const delivery = await bridge.authenticateDelivery(githubEventRoute[1], req.headers, await rawBody(req));''',
    '''      const delivery = await bridge.authenticateDelivery(
        githubEventRoute[1] ?? "",
        req.headers,
        await rawBody(req),
      );''',
)
