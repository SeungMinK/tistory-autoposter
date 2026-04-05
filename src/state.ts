import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export interface PublishState {
  lastPublishAt: string | null; // ISO 8601
  lastScheduledAt: string | null; // ISO 8601 — 예약 발행 시간
  publishedIssues: number[]; // 최근 발행에 포함된 이슈 번호
}

const DEFAULT_STATE: PublishState = {
  lastPublishAt: null,
  lastScheduledAt: null,
  publishedIssues: [],
};

function stateDir(): string {
  return resolve(import.meta.dirname ?? __dirname, "..", "state");
}

function stateFilePath(repoFullName: string): string {
  // "owner/repo" → "owner-repo.json"
  const safe = repoFullName.replace("/", "-");
  return resolve(stateDir(), `${safe}.json`);
}

/**
 * 레포별 발행 상태를 읽는다.
 */
export function loadState(repoFullName: string): PublishState {
  const path = stateFilePath(repoFullName);
  try {
    const raw = readFileSync(path, "utf-8");
    return { ...DEFAULT_STATE, ...JSON.parse(raw) } as PublishState;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/**
 * 레포별 발행 상태를 저장한다.
 */
export function saveState(repoFullName: string, state: PublishState): void {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  const path = stateFilePath(repoFullName);
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf-8");
  console.log(`상태 저장: ${path}`);
}

/**
 * 마지막 발행/예약 시간으로부터 경과 일수를 계산한다.
 * 발행 기록이 없으면 Infinity를 반환 (즉시 발행 가능).
 */
export function daysSinceLastPublish(state: PublishState): number {
  const lastTime = state.lastScheduledAt ?? state.lastPublishAt;
  if (!lastTime) return Infinity;

  const last = new Date(lastTime);
  const now = new Date();
  const diffMs = now.getTime() - last.getTime();
  return diffMs / (1000 * 60 * 60 * 24);
}

/**
 * 다음 발행 날짜를 결정한다.
 * - 마지막 발행이 오늘이면: 내일
 * - 마지막 발행이 어제 이전이면: 오늘 (즉시)
 * - 기록 없으면: 오늘 (즉시)
 *
 * 반환: Date 또는 null (즉시 발행)
 */
export function getNextPublishDate(state: PublishState): Date | null {
  const lastTime = state.lastScheduledAt ?? state.lastPublishAt;
  if (!lastTime) return null; // 즉시 발행

  const last = new Date(lastTime);
  const now = new Date();

  // 같은 날인지 확인 (KST 기준)
  const kstOffset = 9 * 60 * 60 * 1000;
  const lastKST = new Date(last.getTime() + kstOffset);
  const nowKST = new Date(now.getTime() + kstOffset);

  const lastDay = lastKST.toISOString().slice(0, 10);
  const today = nowKST.toISOString().slice(0, 10);

  if (lastDay === today) {
    // 오늘 이미 발행함 → 내일 09:00 KST로 예약
    const tomorrow = new Date(nowKST);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    // KST → UTC
    return new Date(tomorrow.getTime() - kstOffset);
  }

  return null; // 즉시 발행
}
