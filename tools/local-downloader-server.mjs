#!/usr/bin/env node

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const HOST = process.env.DEVTOOLKIT_DLP_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.DEVTOOLKIT_DLP_PORT || '41771', 10);
const DOWNLOAD_DIR = process.env.DEVTOOLKIT_DLP_DIR || path.join(os.homedir(), 'Downloads');
const YT_DLP_BIN = process.env.YT_DLP_BIN || 'yt-dlp';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const REQUEST_BODY_LIMIT = 64 * 1024;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sanitizeTitle(value) {
  if (typeof value !== 'string') {
    return 'devtoolkit';
  }
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return cleaned || 'devtoolkit';
}

function normalizeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.href;
  } catch {
    return '';
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > REQUEST_BODY_LIMIT) {
        reject(new Error('Payload too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', (error) => {
      reject(error);
    });
  });
}

function getBinaryVersion(command, args) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 5000,
    });
    if (result.error || result.status !== 0) {
      return null;
    }
    return (result.stdout || '').split('\n')[0].trim() || null;
  } catch {
    return null;
  }
}

function buildOutputTemplate(prefix) {
  const safePrefix = sanitizeTitle(prefix);
  return path.join(DOWNLOAD_DIR, `${safePrefix}-%(title).180B [%(id)s].%(ext)s`);
}

function runCommand(command, args, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('Process timed out.'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error && error.code === 'ENOENT') {
        reject(new Error(`Command not found: ${command}`));
        return;
      }
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      if (code !== 0) {
        const tail = stderr.trim().split('\n').slice(-4).join('\n') || 'Unknown error.';
        reject(new Error(tail));
        return;
      }
      resolve({ stdout, stderr, durationMs, exitCode: code || 0 });
    });
  });
}

async function handleDownloadVideo(payload) {
  const url = normalizeHttpUrl(payload?.url);
  if (!url) {
    throw new Error('A valid URL is required.');
  }
  const outputTemplate = buildOutputTemplate(payload?.title || 'video');
  const args = ['--no-playlist', '--newline', '-f', 'bv*+ba/b', '-o', outputTemplate, url];
  const result = await runCommand(YT_DLP_BIN, args);
  return {
    ok: true,
    mode: 'download-video',
    outputTemplate,
    ...result,
  };
}

async function handleExtractAudio(payload) {
  const url = normalizeHttpUrl(payload?.url);
  if (!url) {
    throw new Error('A valid URL is required.');
  }
  const audioFormatRaw =
    typeof payload?.audioFormat === 'string' ? payload.audioFormat.toLowerCase() : 'mp3';
  const audioFormat = ['mp3', 'm4a', 'aac', 'wav', 'opus', 'flac'].includes(audioFormatRaw)
    ? audioFormatRaw
    : 'mp3';
  const outputTemplate = buildOutputTemplate(payload?.title || 'audio');
  const args = [
    '--no-playlist',
    '--newline',
    '--extract-audio',
    '--audio-format',
    audioFormat,
    '--audio-quality',
    '0',
    '-o',
    outputTemplate,
    url,
  ];
  if (FFMPEG_BIN && FFMPEG_BIN !== 'ffmpeg') {
    args.splice(0, 0, '--ffmpeg-location', FFMPEG_BIN);
  }
  const result = await runCommand(YT_DLP_BIN, args);
  return {
    ok: true,
    mode: 'extract-audio',
    audioFormat,
    outputTemplate,
    ...result,
  };
}

const ytDlpVersion = getBinaryVersion(YT_DLP_BIN, ['--version']);
const ffmpegVersion = getBinaryVersion(FFMPEG_BIN, ['-version']);

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, { ok: true });
    return;
  }

  const reqUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const pathname = reqUrl.pathname;

  try {
    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'devtoolkit-local-downloader',
        host: HOST,
        port: PORT,
        version: '1.0.0',
        ytDlpBin: YT_DLP_BIN,
        ffmpegBin: FFMPEG_BIN,
        ytDlpVersion,
        ffmpegVersion: ffmpegVersion ? ffmpegVersion.split('\n')[0] : null,
        downloadDir: DOWNLOAD_DIR,
      });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    const body = await readJsonBody(req);

    if (pathname === '/download-video') {
      const result = await handleDownloadVideo(body);
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/extract-audio') {
      const result = await handleExtractAudio(body);
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found.' });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unexpected helper error.',
    });
  }
});

server.listen(PORT, HOST, () => {
  const ready = {
    service: 'devtoolkit-local-downloader',
    host: HOST,
    port: PORT,
    downloadDir: DOWNLOAD_DIR,
    ytDlpBin: YT_DLP_BIN,
    ffmpegBin: FFMPEG_BIN,
    ytDlpVersion: ytDlpVersion || 'missing',
    ffmpegVersion: ffmpegVersion ? ffmpegVersion.split('\n')[0] : 'missing',
  };
  process.stdout.write(`${JSON.stringify(ready)}\n`);
});
