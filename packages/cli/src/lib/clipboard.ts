import { execFileSync } from "node:child_process";

function platformClipCommand(): string[] | null {
  switch (process.platform) {
    case "win32":
      return ["clip"];
    case "darwin":
      return ["pbcopy"];
    case "linux":
      return process.env.WAYLAND_DISPLAY ? ["wl-copy"] : ["xclip", "-selection", "clipboard"];
    default:
      return null;
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  const command = platformClipCommand();
  if (!command) return false;

  const cmd = command[0]!;
  const args = command.slice(1);
  try {
    execFileSync(cmd, args, {
      input: text,
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}
