
import { IGitProvider, GitRepoInfo, ProviderInfo } from '@yl/types';
import { spawn } from 'child_process';

export class GitHubGitProvider implements IGitProvider {
  info: ProviderInfo = {
    id: 'git-github',
    type: 'git',
    name: 'GitHub',
    version: '0.1.0'
  };

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  private async execGit(args: string[], cwd?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, { cwd });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`git ${args.join(' ')} failed with code ${code}`));
      });
    });
  }

  async clone(repo: GitRepoInfo, path: string): Promise<void> {
    let url = repo.url;
    if (repo.auth?.token) {
      url = url.replace('https://', `https://${repo.auth.token}@`);
    }
    const args = ['clone', url, path];
    if (repo.branch) {
      args.push('-b', repo.branch);
    }
    await this.execGit(args);
  }

  async pull(path: string): Promise<void> {
    await this.execGit(['pull'], path);
  }

  async push(path: string): Promise<void> {
    await this.execGit(['push'], path);
  }

  async commit(path: string, message: string): Promise<void> {
    await this.execGit(['add', '.'], path);
    await this.execGit(['commit', '-m', message], path);
  }

  async createPR(path: string, title: string, body: string, head: string, base: string): Promise<string> {
    // This requires GitHub CLI (gh) or API. For now, we'll just throw not implemented for PR creation via git provider.
    // In a real implementation, we would use octokit or gh CLI.
    throw new Error('createPR requires GitHub API integration, not implemented in basic git adapter');
  }
}
