// Composition root - will become 300-line final. For now re-exports canonical App to avoid breaking build.
import { App as CanonicalApp } from "../App";
export default CanonicalApp;
export { App } from "../App";
