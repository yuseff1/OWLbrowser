import './lib/mock'; // installs a preview-only window.owl when not running inside Electron
import '@fontsource-variable/inter';
import './app.css';
import './lib/ui/ui.css';
import { mount } from 'svelte';
import App from './App.svelte';
import PopupApp from './lib/popup/PopupApp.svelte';

// `?popup=1`: this document is the popup layer (menus / omnibox dropdown drawn above native page views)
const popup = new URLSearchParams(location.search).get('popup') === '1';
const app = mount(popup ? PopupApp : App, { target: document.getElementById('app')! });
export default app;
