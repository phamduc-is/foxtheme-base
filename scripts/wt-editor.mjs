/**
 * Shared helper — add/remove a worktree folder in the running editor window.
 *
 * OPT-IN via `FOX_WT_EDITOR`, and OFF by default, because the editor CLI's
 * `--add`/`--remove` act on the **last active window**: with both the core repo
 * and a child fork open, a worktree can silently land in the wrong window. Off
 * by default also keeps an unattended `/ship-batch` (or CI, or a machine with no
 * editor CLI on PATH) from ever depending on this.
 *
 *   FOX_WT_EDITOR=cursor   # or `code`, or any editor CLI taking --add/--remove
 *   FOX_WT_EDITOR=off      # explicit off (same as unset)
 *
 * Set it when you work on one window at a time and want new worktrees to show up
 * in Source Control without "Add Folder to Workspace…" every time. Note the
 * first added folder turns a single-folder window into an Untitled Workspace.
 *
 * Always best-effort: any failure warns and returns false, never throws.
 */
import { spawnSync } from "node:child_process";

const cli = () => {
  const v = (process.env.FOX_WT_EDITOR || "").trim();
  return !v || v === "off" || v === "0" || v === "false" ? null : v;
};

const run = (flag, dir, verb) => {
  const bin = cli();
  if (!bin) return false;
  const r = spawnSync(bin, [flag, dir], { stdio: "ignore" });
  if (r.error || r.status !== 0) {
    // A missing CLI or a headless session is expected, not an error worth failing on.
    console.warn(`  ! could not ${verb} the worktree in "${bin}" (FOX_WT_EDITOR) — do it manually if you want it in Source Control.`);
    return false;
  }
  console.log(`  ▸ ${verb}d in ${bin}`);
  return true;
};

export const editorAdd = (dir) => run("--add", dir, "add");
export const editorRemove = (dir) => run("--remove", dir, "remove");
