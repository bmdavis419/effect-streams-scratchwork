<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<title>My SvelteKit App</title>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="flex min-h-screen bg-neutral-900 text-neutral-100">
	{@render children?.()}
</div>
