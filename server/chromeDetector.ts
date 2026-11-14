import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChromeDetectionStatus } from '../src/types/testing.ts';

function isValidExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform !== 'win32') {
      fs.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function getCandidateChromePaths(): Array<{ path: string; method: string }> {
  const candidates: Array<{ path: string; method: string }> = [];

  const envPath = process.env.CHROME_EXECUTABLE_PATH?.trim();
  if (envPath) {
    candidates.push({ path: path.resolve(envPath), method: 'CHROME_EXECUTABLE_PATH' });
  }

  if (process.platform === 'linux') {
    candidates.push(
      { path: '/usr/bin/google-chrome', method: 'linux-standard-path' },
      { path: '/usr/bin/google-chrome-stable', method: 'linux-standard-path' },
      { path: '/opt/google/chrome/chrome', method: 'linux-opt-path' },
      { path: '/opt/google/chrome/google-chrome', method: 'linux-opt-path' }
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      {
        path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        method: 'macos-applications',
      },
      {
        path: path.join(
          os.homedir(),
          'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        ),
        method: 'macos-user-applications',
      }
    );
  } else if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const programFiles = process.env['PROGRAMFILES'] || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

    candidates.push(
      {
        path: path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        method: 'windows-program-files',
      },
      {
        path: path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        method: 'windows-program-files-x86',
      },
      {
        path: path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        method: 'windows-local-appdata',
      }
    );
  }

  return candidates;
}

export function detectGoogleChrome(): ChromeDetectionStatus {
  const checkedAt = new Date().toISOString();
  const candidates = getCandidateChromePaths();

  for (const candidate of candidates) {
    if (isValidExecutableFile(candidate.path)) {
      return {
        installed: true,
        executablePath: candidate.path,
        detectionMethod: candidate.method,
        checkedAt,
        error: null,
      };
    }
  }

  return {
    installed: false,
    executablePath: null,
    detectionMethod: 'filesystem-scan',
    checkedAt,
    error:
      'Google Chrome binary was not found on this machine. Install Google Chrome or set CHROME_EXECUTABLE_PATH.',
  };
}
