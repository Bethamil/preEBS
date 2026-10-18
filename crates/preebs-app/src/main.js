import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { applyTheme, readTheme } from "./lib/theme.js";

applyTheme(readTheme());

const target = document.getElementById("app");
mount(App, { target });
