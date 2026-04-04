import type { IssuePayload } from "./types.js";
import type { BatchConfig } from "./project-config.js";

/**
 * GitHub REST API 클라이언트.
 * 소스 레포의 이슈에 라벨 추가, 코멘트 작성, 라벨별 이슈 조회.
 */
export class GitHubClient {
  private baseUrl = "https://api.github.com";
  private headers: Record<string, string>;

  constructor(private token: string) {
    this.headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  /**
   * 이슈에 라벨을 추가한다. 라벨이 없으면 자동 생성.
   */
  async addLabel(repo: string, issueNumber: number, label: string): Promise<void> {
    // 라벨이 레포에 없으면 생성
    await this.ensureLabel(repo, label);

    const url = `${this.baseUrl}/repos/${repo}/issues/${issueNumber}/labels`;
    const res = await fetch(url, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ labels: [label] }),
    });

    if (!res.ok && res.status !== 422) {
      // 422 = already has label, 무시
      throw new Error(`라벨 추가 실패: ${res.status} ${res.statusText}`);
    }
  }

  /**
   * 이슈에서 라벨을 제거한다.
   */
  async removeLabel(repo: string, issueNumber: number, label: string): Promise<void> {
    const url = `${this.baseUrl}/repos/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: this.headers,
    });
    // 404 = 이미 없음, 무시
    if (!res.ok && res.status !== 404) {
      throw new Error(`라벨 제거 실패: ${res.status} ${res.statusText}`);
    }
  }

  /**
   * 이슈에 코멘트를 작성한다.
   */
  async addComment(repo: string, issueNumber: number, body: string): Promise<void> {
    const url = `${this.baseUrl}/repos/${repo}/issues/${issueNumber}/comments`;
    const res = await fetch(url, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });

    if (!res.ok) {
      throw new Error(`코멘트 작성 실패: ${res.status} ${res.statusText}`);
    }
  }

  /**
   * 특정 라벨이 달린 closed 이슈 목록을 조회한다.
   */
  async getIssuesWithLabel(repo: string, label: string): Promise<IssuePayload["issue"][]> {
    const url = `${this.baseUrl}/repos/${repo}/issues?labels=${encodeURIComponent(label)}&state=closed&per_page=30&sort=created&direction=desc`;
    const res = await fetch(url, {
      method: "GET",
      headers: this.headers,
    });

    if (!res.ok) {
      throw new Error(`이슈 조회 실패: ${res.status} ${res.statusText}`);
    }

    const issues = (await res.json()) as Array<{
      number: number;
      title: string;
      body: string | null;
      html_url: string;
      labels: Array<{ name: string }>;
      user: { login: string };
      pull_request?: unknown;
    }>;

    // PR은 제외
    return issues
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        body: i.body ?? "",
        html_url: i.html_url,
        labels: i.labels,
        user: { login: i.user.login },
      }));
  }

  /**
   * 라벨이 레포에 존재하는지 확인하고 없으면 생성.
   */
  private async ensureLabel(repo: string, label: string): Promise<void> {
    const url = `${this.baseUrl}/repos/${repo}/labels/${encodeURIComponent(label)}`;
    const res = await fetch(url, { method: "GET", headers: this.headers });

    if (res.status === 404) {
      const colorMap: Record<string, string> = {
        "blog-적합": "0e8a16",
        "blog-부적합": "e4e669",
        "blog-완료": "0075ca",
      };
      await fetch(`${this.baseUrl}/repos/${repo}/labels`, {
        method: "POST",
        headers: { ...this.headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: label,
          color: colorMap[label] ?? "ededed",
          description: `tistory-autoposter: ${label}`,
        }),
      });
    }
  }

  /**
   * 배치 발행 후 이슈들을 blog-완료 처리.
   * blog-적합 라벨 제거 + blog-완료 라벨 추가 + 코멘트.
   */
  async markIssuesPublished(
    repo: string,
    issues: IssuePayload["issue"][],
    batchCfg: BatchConfig,
    postUrl: string,
  ): Promise<void> {
    for (const issue of issues) {
      try {
        await this.removeLabel(repo, issue.number, batchCfg.labels.worthy);
        await this.addLabel(repo, issue.number, batchCfg.labels.published);
        await this.addComment(
          repo,
          issue.number,
          `📝 이 이슈가 블로그 글에 포함되어 발행되었습니다.\n🔗 ${postUrl}`,
        );
      } catch (err) {
        console.warn(`이슈 #${issue.number} 완료 처리 실패 (계속 진행): ${err}`);
      }
    }
  }
}
