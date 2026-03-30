import { createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

import { render } from 'ink';
import { createElement } from 'react';

import { createCliRuntime } from './default-runtime.js';
import { InkRuntimeApp } from './ink-app.js';
import { RuntimeController } from './runtime-controller.js';
import {
  HELP_TEXT,
  executeConsoleInput,
  formatEntryText,
  isExitInput,
} from './ui-helpers.js';
import type { RuntimeControllerLike } from './types.js';

export class RuntimeConsole {
  controller: RuntimeControllerLike;
  inputStream: NodeJS.ReadStream;
  outputStream: NodeJS.WriteStream;

  constructor({
    controller,
    inputStream = input,
    outputStream = output,
  }: {
    controller?: RuntimeControllerLike;
    inputStream?: NodeJS.ReadStream;
    outputStream?: NodeJS.WriteStream;
  } = {}) {
    this.controller = controller ?? new RuntimeController({
      runtime: createCliRuntime(),
      bootstrapAssistant: true,
    });
    this.inputStream = inputStream;
    this.outputStream = outputStream;
  }

  async start(): Promise<void> {
    await this.controller.initialize();

    if (!this.inputStream.isTTY || !this.outputStream.isTTY) {
      return this.#startLineMode();
    }

    return this.#startFullscreenMode();
  }

  async #startLineMode(): Promise<void> {
    const readline = createInterface({
      input: this.inputStream,
      output: this.outputStream,
      terminal: true,
    });

    this.outputStream.write(`${HELP_TEXT}\n`);
    readline.setPrompt('agents> ');
    readline.prompt();

    try {
      for await (const rawLine of readline) {
        const line = rawLine.trim();

        if (!line) {
          readline.prompt();
          continue;
        }

        if (isExitInput(line)) {
          break;
        }

        try {
          const outputEntries = await executeConsoleInput(this.controller, line);
          if (outputEntries.length > 0) {
            this.outputStream.write(`${outputEntries.map((entry) => formatEntryText(entry)).join('\n')}\n`);
          }
        } catch (error) {
          this.outputStream.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        }

        readline.prompt();
      }
    } finally {
      readline.close();
      await this.controller.waitForIdle();
      await this.controller.persistState('console.shutdown');
      this.controller.dispose();
    }
  }

  async #startFullscreenMode(): Promise<void> {
    this.#enterAltScreen();
    try {
      const app = render(createElement(InkRuntimeApp, { controller: this.controller }), {
        stdin: this.inputStream,
        stdout: this.outputStream,
        stderr: this.outputStream,
        exitOnCtrlC: false,
      });
      await app.waitUntilExit();
    } finally {
      this.#leaveAltScreen();
      await this.controller.waitForIdle();
      await this.controller.persistState('console.shutdown');
      this.controller.dispose();
    }
  }

  #enterAltScreen(): void {
    this.outputStream.write('\x1b[?1049h\x1b[?25h');
  }

  #leaveAltScreen(): void {
    this.outputStream.write('\x1b[?1049l\x1b[?25h');
  }
}
