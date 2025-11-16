<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<title>My SvelteKit App</title>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-between bg-neutral-900 text-neutral-100">
	<header class="py-4"></header>
	{@render children?.()}
	<footer class="py-4"></footer>
</div>
