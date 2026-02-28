const cdSpec: Fig.Spec = {
	name: 'Set-Location',
	description: 'Change the shell working directory',
	args: {
		name: 'folder',
		template: 'folders',
		suggestions: [
			{
				name: '-',
				description: 'Go to previous directory in history stack',
				hidden: true,
			},
			{
				name: '+',
				description: 'Go to next directory in history stack',
				hidden: true,
			},
		],
	}
};

export default cdSpec;
