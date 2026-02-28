import { publishRepository } from './publish.js';
import { API as GitAPI, RemoteSourcePublisher, Repository } from './typings/git.js';

export class GithubRemoteSourcePublisher implements RemoteSourcePublisher {
	readonly name = 'GitHub';
	readonly icon = 'github';

	constructor(private gitAPI: GitAPI) { }

	publishRepository(repository: Repository): Promise<void> {
		return publishRepository(this.gitAPI, repository);
	}
}
