#!/usr/bin/env -S node --enable-source-maps --import tsx
import { RuntimeConsole } from '../src/cli/runtime-ui.js';

const consoleApp = new RuntimeConsole();
await consoleApp.start();
