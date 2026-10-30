/** IDEA-290: files an agent run leaves behind in `.ingot/artifacts/<runId>/`. */
export const ARTIFACTS_DIR = '.ingot/artifacts';
export const PLAN_FILE = 'plan.md';
export const WALKTHROUGH_FILE = 'walkthrough.md';
export const SCREENSHOTS_DIR = 'screenshots';
export const RUN_META_FILE = 'run.json';
export const COMMENTS_FILE = 'comments.json';
export const MARKDOWN_EXT = '.md';
export const PNG_EXT = '.png';
export const PNG_MEDIA_TYPE = 'image/png';

/** The agent tool that writes an artifact: `ingot/artifact {"name": "plan.md", "content": "…"}`. */
export const ARTIFACT_TOOL = 'artifact';
export const ARTIFACT_TOOL_DESCRIPTION = 'Write a run artifact the user reviews in the Artifacts view (not a project file, no review). Arguments: {"name": "plan.md" | "walkthrough.md" | "<name>.md", "content": "markdown"}. Write plan.md before a multi-step change and walkthrough.md when done. The user can comment on any line; comments come back as messages. Runs at once.';

export const ARTIFACT_NAME_MAX = 64;
export const ARTIFACT_MAX_CHARS = 200_000;
export const WALKTHROUGH_REPLY_CHARS = 4_000;
export const STEER_QUOTE_CHARS = 160;
/** Runs listed in the viewer, newest first. */
export const ARTIFACT_RUNS_LIMIT = 50;
export const RUN_TURN_PREFIX = 'r';
export const COMMENT_PREFIX = 'Comment on artifact';
