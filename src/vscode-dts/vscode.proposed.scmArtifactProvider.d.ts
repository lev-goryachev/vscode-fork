declare module 'vscode' {
	// https://github.com/microsoft/vscode/issues/253665

	export interface SourceControl {
		artifactProvider?: SourceControlArtifactProvider;
	}

	export interface SourceControlArtifactProvider {
		readonly onDidChangeArtifacts: Event<string[]>;

		provideArtifactGroups(token: CancellationToken): ProviderResult<SourceControlArtifactGroup[]>;
		provideArtifacts(group: string, token: CancellationToken): ProviderResult<SourceControlArtifact[]>;
	}

	export interface SourceControlArtifactGroup {
		readonly id: string;
		readonly name: string;
		readonly icon?: IconPath;
		readonly supportsFolders?: boolean;
	}

	export interface SourceControlArtifact {
		readonly id: string;
		readonly name: string;
		readonly description?: string;
		readonly icon?: IconPath;
		readonly timestamp?: number;
		readonly command?: Command;
	}
}
