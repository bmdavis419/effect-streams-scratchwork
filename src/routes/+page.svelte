<script lang="ts">
	import logo from '$lib/assets/favicon.svg';

	const handleFetchFirstStream = async () => {
		const response = await fetch('/api/streams/first', {
			method: 'POST',
			body: JSON.stringify({ message: 'Hello, world!' })
		});
		console.log(response.body);
	};
</script>

<main class="flex grow flex-col items-center justify-center gap-4">
	<div class="flex flex-row items-center justify-center gap-2">
		<img src={logo} alt="Logo" class="h-24 w-24" />
		<h2 class="text-3xl font-bold"><span class="text-primary">SvelteKit</span> App</h2>
	</div>
	<p class="text-center text-lg text-neutral-500">We're doing some testing here...</p>

	<button onclick={handleFetchFirstStream} class="rounded-md bg-primary px-4 py-2 text-white"
		>Fetch First Stream</button
	>
</main>
