import { spawn } from 'node:child_process'
import { log } from './log.js'

/**
 * The platform command that opens a URL in the default browser.
 * Split out from the spawn so it can be asserted per platform in tests.
 */
export function browserCommand (url, platform = process.platform) {
  if (platform === 'win32') {
    // `start` is a cmd builtin, so it must run through cmd. The empty string is
    // start's window-title argument: without it, a quoted URL would be consumed
    // as the title and nothing would open.
    return { cmd: 'cmd', args: ['/c', 'start', '', url] }
  }
  if (platform === 'darwin') return { cmd: 'open', args: [url] }
  return { cmd: 'xdg-open', args: [url] }
}

/**
 * Open a URL in the default browser. Never throws: failing to launch a browser
 * must not take down a server that is already listening, and the URL is always
 * printed as a fallback.
 */
export function openBrowser (url) {
  const { cmd, args } = browserCommand(url)
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true })
    child.on('error', err => log.debug(`Could not launch a browser (${cmd}): ${err.message}`))
    child.unref()
    return true
  } catch (err) {
    log.debug(`Could not launch a browser (${cmd}): ${err.message}`)
    return false
  }
}
