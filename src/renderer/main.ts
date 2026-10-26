import './lib/mock'; // installs a preview-only window.owl when not running inside Electron
import '@fontsource-variable/inter';
import './app.css';
import './lib/ui/ui.css';
import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });
export default app;
