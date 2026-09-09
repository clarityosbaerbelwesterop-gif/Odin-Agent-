// Vercel compiles TypeScript functions in an isolated transpilation step after the
// repository build. Keep the deployment wrapper JavaScript-only and import the
// already typechecked build artifact so the canonical `npm run build` remains the
// sole TypeScript compilation path.
import { hostedHandler } from "../dist/src/chat/hosted.js";

export default hostedHandler;
