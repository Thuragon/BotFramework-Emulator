//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.
//
// Microsoft Bot Framework: http://botframework.com
//
// Bot Framework Emulator Github:
// https://github.com/Microsoft/BotFramwork-Emulator
//
// Copyright (c) Microsoft Corporation
// All rights reserved.
//
// MIT License:
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED ""AS IS"", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//

import * as Electron from 'electron';

import { mainWindow } from './main';
import { AppUpdater, UpdateStatus } from './appUpdater';
import { BotInfo, SharedConstants } from '@bfemulator/app-shared';
import * as jsonpath from 'jsonpath';
import { ConversationService } from './services/conversationService';
import { getStore } from './botData/store';
import { getStore as getSettingsStore } from './settingsData/store';
import { rememberTheme } from './settingsData/actions/windowStateActions';

declare type MenuOpts = Electron.MenuItemConstructorOptions;

export interface AppMenuBuilder {
  menuTemplate: MenuOpts[];
  getAppMenuTemplate: () => MenuOpts[];
  createRecentBotsList: (bots: BotInfo[]) => MenuOpts[];
  getFileMenu: (recentBots?: BotInfo[]) => MenuOpts;
  getAppMenuMac: () => MenuOpts;
  getEditMenu: () => MenuOpts;
  getEditMenuMac: () => MenuOpts[];
  getViewMenu: () => MenuOpts;
  getWindowMenuMac: () => MenuOpts[];
  getHelpMenu: () => MenuOpts;
  setFileMenu: (fileMenuTemplate: MenuOpts, appMenuTemplate: MenuOpts[]) => MenuOpts[];
}

export const AppMenuBuilder = new class AppMenuBuilderImpl implements AppMenuBuilder {
  private _menuTemplate: MenuOpts[];

  /** Allows preservation of menu state without having to completely rebuild the menu template */
  get menuTemplate(): MenuOpts[] {
    return this._menuTemplate ? this._menuTemplate : this.getAppMenuTemplate();
  }

  set menuTemplate(template: MenuOpts[]) {
    this._menuTemplate = template;
  }

  /** Constructs the initial app menu template */
  getAppMenuTemplate(): MenuOpts[] {
    const template: MenuOpts[] = [
      this.getFileMenu(),
      this.getEditMenu(),
      this.getViewMenu(),
      this.getConversationMenu(),
      this.getHelpMenu()
    ];

    if (process.platform === 'darwin') {
      /*
      // Create the Application's main menu
      var template2: MenuOpts[] = [
        {
          label: windowTitle,
          submenu: [
            { label: "About", click: () => Emulator.send('showExplorer-about') },
            { type: "separator" },
            { label: "Quit", accelerator: "Command+Q", click: () => Electron.app.quit() }
          ]
        }, {
          label: "Edit",
          submenu: [
            { label: "Undo", accelerator: "CmdOrCtrl+Z", role: "undo" },
            { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", role: "redo" },
            { type: "separator" },
            { label: "Cut", accelerator: "CmdOrCtrl+X", role: "cut" },
            { label: "Copy", accelerator: "CmdOrCtrl+C", role: "copy" },
            { label: "Paste", accelerator: "CmdOrCtrl+V", role: "paste" },
            { label: "Select All", accelerator: "CmdOrCtrl+A", role: "selectall" }
          ]
        }*/

      template.unshift(this.getAppMenuMac());

      // Edit menu
      (template[2].submenu as any).push(this.getEditMenuMac());

      // Window menu
      template.splice(4, 0, {
        label: 'Window',
        submenu: this.getWindowMenuMac()
      });
    }
    // save menu state
    this.menuTemplate = template;
    return template;
  }

  /** Creates a file menu item for each bot that will set the bot as active when clicked */
  createRecentBotsList(bots: BotInfo[]): MenuOpts[] {
    // only list 5 most-recent bots
    return bots.filter(bot => !!bot).map(bot => ({
      label: bot.displayName,
      click: () => {
        mainWindow.commandService.remoteCall(SharedConstants.Commands.Bot.Switch, bot.path)
          .catch(err => console.error('Error while switching bots from file menu recent bots list: ', err));
      }
    }));
  }

  /** Constructs a file menu template. If recentBots is passed in, will add recent bots list to menu */
  getFileMenu(recentBots?: BotInfo[]): MenuOpts {
    const { Azure, UI, Bot, Emulator } = SharedConstants.Commands;
    // TODO - localization
    let subMenu: MenuOpts[] = [
      {
        label: 'New Bot Configuration...',
        click: () => {
          mainWindow.commandService.remoteCall(UI.ShowBotCreationDialog);
        }
      },
      { type: 'separator' },
      {
        label: 'Open Bot Configuration...',
        click: () => {
          mainWindow.commandService.remoteCall(Bot.OpenBrowse);
        }
      }];
    if (recentBots && recentBots.length) {
      const recentBotsList = this.createRecentBotsList(recentBots);
      subMenu.push({
        label: 'Open Recent...',
        submenu: [...recentBotsList]
      });
    } else {
      subMenu.push({
        label: 'Open Recent...',
        enabled: false
      });
    }
    subMenu.push({ type: 'separator' });

    subMenu.push({
      label: 'Open Transcript...',
      click: () => {
        mainWindow.commandService.remoteCall(Emulator.PromptToOpenTranscript)
          .catch(err => console.error('Error opening transcript file from menu: ', err));
      }
    },
      { type: 'separator' },
      {
        label: 'Close Tab',
        click: () => {
          mainWindow.commandService.remoteCall(Bot.Close);
        }
      }
    );
    const settingsStore = getSettingsStore();
    const settingsState = settingsStore.getState();

    const { signedInUser } = settingsState.azure;
    const azureMenuItemLabel = signedInUser ? `Sign out (${signedInUser})` : 'Sign in with Azure';
    subMenu.push({ type: 'separator' });
    subMenu.push({
      label: azureMenuItemLabel,
      click: async () => {
        if (signedInUser) {
          await mainWindow.commandService.call(Azure.SignUserOutOfAzure);
          await mainWindow.commandService.remoteCall(UI.InvalidateAzureArmToken);
        } else {
          await mainWindow.commandService.remoteCall(UI.SignInToAzure);
        }
      }
    });

    const { availableThemes, theme } = settingsState.windowState;
    subMenu.push.apply(subMenu, [
      { type: 'separator' },
      {
        label: 'Themes',
        submenu: availableThemes.map(t => (
          {
            label: t.name,
            type: 'checkbox',
            checked: theme === t.name,
            click: async () => {
              settingsStore.dispatch(rememberTheme(t.name));

              await mainWindow.commandService.call(SharedConstants.Commands.Electron.UpdateFileMenu);
            }
          }
        ))
      }
    ]);
    subMenu.push({ type: 'separator' });
    subMenu.push({ role: 'quit' });

    const template: MenuOpts = {
      label: 'File',
      submenu: subMenu
    };

    return template;
  }

  getAppMenuMac(): MenuOpts {
    return {
      label: Electron.app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services', submenu: [] },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideothers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    };
  }

  getEditMenu(): MenuOpts {
    return {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { role: 'selectall' },
      ]
    };
  }

  getEditMenuMac(): MenuOpts[] {
    return [
      { type: 'separator' },
      {
        label: 'Speech',
        submenu: [
          { role: 'startspeaking' },
          { role: 'stopspeaking' }
        ]
      }
    ];
  }

  getViewMenu(): MenuOpts {
    // TODO - localization
    return {
      label: 'View',
      submenu: [
        {
          label: 'Explorer',
          click: () => mainWindow.commandService.remoteCall(SharedConstants.Commands.UI.ShowExplorer)
        },
        {
          label: 'Emulator Settings',
          click: () => mainWindow.commandService.remoteCall(SharedConstants.Commands.UI.ShowAppSettings)
        },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ]
    };
  }

  getWindowMenuMac(): MenuOpts[] {
    return [
      { role: 'close' },
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'front' }
    ];
  }

  getHelpMenu(): MenuOpts {
    let appName = Electron.app.getName();
    let version = Electron.app.getVersion();
    // TODO - localization
    return {
      role: 'help',
      submenu: [
        {
          label: 'Welcome',
          click: () => mainWindow.commandService.remoteCall(SharedConstants.Commands.UI.ShowWelcomePage)
        },
        { type: 'separator' },
        {
          label: 'Privacy',
          click: () => mainWindow.commandService.remoteCall(
            SharedConstants.Commands.Electron.OpenExternal,
            'https://go.microsoft.com/fwlink/?LinkId=512132'
          )
        },
        {
          // TODO: Proper link for the license instead of third party credits
          label: 'License',
          click: () => mainWindow.commandService.remoteCall(
            SharedConstants.Commands.Electron.OpenExternal,
            'https://aka.ms/O10ww2'
          )
        },
        {
          label: 'Credits',
          click: () => mainWindow.commandService.remoteCall(
            SharedConstants.Commands.Electron.OpenExternal,
            'https://aka.ms/Ud5ga6'
          )
        },
        { type: 'separator' },
        {
          label: 'Report an issue',
          click: () => mainWindow.commandService.remoteCall(
            SharedConstants.Commands.Electron.OpenExternal,
            'https://aka.ms/cy106f'
          )
        },
        { type: 'separator' },
        { role: 'toggledevtools' },
        {
          label: 'Toggle Developer Tools (Inspector)',
          click: () => mainWindow.commandService.remoteCall(SharedConstants.Commands.Electron.ToggleDevTools)
        },
        { type: 'separator' },
        this.getUpdateMenuItem(),
        { type: 'separator' },
        {
          label: 'About',
          click: () => Electron.dialog.showMessageBox(mainWindow.browserWindow, {
            type: 'info',
            title: appName,
            message: appName + '\r\nversion: ' + version
          })
        }
      ]
    };
  }

  getUpdateMenuItem(): MenuOpts {
    // TODO - localization
    if (AppUpdater.status === UpdateStatus.UpdateReadyToInstall) {
      return {
        id: 'auto-update',
        label: 'Restart to Update...',
        click: () => AppUpdater.quitAndInstall(),
        enabled: true,
      };
    } else if (AppUpdater.status === UpdateStatus.CheckingForUpdate) {
      return {
        id: 'auto-update',
        label: 'Checking for update...',
        enabled: false,
      };
    } else if (AppUpdater.status === UpdateStatus.UpdateDownloading ||
      AppUpdater.status === UpdateStatus.UpdateAvailable) {
      return {
        id: 'auto-update',
        label: 'Update downloading...',
        enabled: false,
      };
    } else {
      return {
        id: 'auto-update',
        label: 'Check for Update...',
        click: () => AppUpdater.checkForUpdates(true, false),
        enabled: true,
      };
    }
  }

  getConversationMenu(): MenuOpts {
    const getState = () => mainWindow.commandService.remoteCall(SharedConstants.Commands.Misc.GetStoreState);
    const getConversationId = async () => {
      const state = await getState();
      const { editors, activeEditor } = state.editor;
      const { activeDocumentId } = editors[activeEditor];
      return state.chat.chats[activeDocumentId].conversationId;
    };

    const getServiceUrl = () => getStore().getState().serviceUrl;
    const createClickHandler = serviceFunction => {
      return () => {
        getConversationId()
          .then(conversationId => serviceFunction(getServiceUrl(), conversationId));
      };
    };
    return {
      label: 'Conversation',
      submenu: [
        {
          label: 'Send System Activity',
          submenu: [
            {
              label: 'conversationUpdate ( user added )',
              click: createClickHandler(ConversationService.addUser)
            },
            {
              label: 'conversationUpdate ( user removed )',
              click: createClickHandler(ConversationService.removeUser)
            },
            {
              label: 'contactRelationUpdate ( bot added )',
              click: createClickHandler(ConversationService.botContactAdded)
            },
            {
              label: 'contactRelationUpdate ( bot removed )',
              click: createClickHandler(ConversationService.botContactRemoved)
            },
            {
              label: 'typing',
              click: createClickHandler(ConversationService.typing)
            },
            {
              label: 'ping',
              click: createClickHandler(ConversationService.ping)
            },
            {
              label: 'deleteUserData',
              click: createClickHandler(ConversationService.deleteUserData)
            }
          ]
        },
      ]
    };
  }

  /**
   * Takes a file menu template and places it at the
   * right position in the app menu template according to platform
   */
  setFileMenu(fileMenuTemplate: MenuOpts, appMenuTemplate: MenuOpts[]): MenuOpts[] {
    if (process.platform === 'darwin') {
      appMenuTemplate[1] = fileMenuTemplate;
    } else {
      appMenuTemplate[0] = fileMenuTemplate;
    }
    return appMenuTemplate;
  }

  refreshAppUpdateMenu() {
    jsonpath.value(this.menuTemplate,
      '$..[?(@.role == "help")].submenu[?(@.id == "auto-update")]', this.getUpdateMenuItem());
    Electron.Menu.setApplicationMenu(Electron.Menu.buildFromTemplate(this.menuTemplate));
  }
};
