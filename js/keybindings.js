/*
There are three possible ways that keybindings can be handled.
 Shortcuts that appear in the menubar are registered in main.js, and send IPC messages to the window (which are handled by menuRenderer.js)
 - If the browser UI is focused, shortcuts are handled by Mousetrap.
  - If a BrowserView is focused, shortcuts are handled by the before-input-event listener.
  */

const Mousetrap = require('mousetrap')
const keyMapModule = require('util/keyMap.js')

var webviews = require('webviews.js')
var browserUI = require('browserUI.js')
var focusMode = require('focusMode.js')
var modalMode = require('modalMode.js')
var settings = require('util/settings/settings.js')

var keyMap = keyMapModule.userKeyMap(settings.get('keyMap'))

var shortcutsList = []
var registeredMousetrapBindings = {}

/*
Determines whether a shortcut can actually run
single-letter shortcuts and shortcuts used for text editing can't run when an input is focused
*/
function checkShortcutCanRun (combo, cb) {
  if (/^\w$/.test(combo) || combo === 'mod+left' || combo === 'mod+right') {
    var webview = webviews.get(tabs.getSelected())
    if (!tabs.get(tabs.getSelected()).url || !webview.isFocused()) {
      // check whether an input is focused in the browser UI
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
        cb(false)
      } else {
        cb(true)
      }
    } else {
      // check whether an input is focused in the webview
      webviews.callAsync(tabs.getSelected(), 'executeJavaScript', `
      document.activeElement.tagName === "INPUT"
      || document.activeElement.tagName === "TEXTAREA"
      || document.activeElement.tagName === "IFRAME"
      || (function () {
        var n = document.activeElement;
        while (n) {
          if (n.getAttribute && n.getAttribute("contenteditable")) {
            return true;
          }
          n = n.parentElement;
        }
        return false;
      })()
      `, function (err, isInputFocused) {
        if (err) {
          console.warn(err)
          return
        }
        cb(isInputFocused === false)
      })
    }
  } else {
    cb(true)
  }
}

function defineShortcut (keysOrKeyMapName, fn, options = {}) {
  if (keysOrKeyMapName.keys) {
    var binding = keysOrKeyMapName.keys
  } else {
    var binding = keyMap[keysOrKeyMapName]
  }

  if (typeof binding === 'string') {
    binding = [binding]
  }

  var shortcutCallback = function (e, combo) {
    // Disable shortcuts for modal mode.
    if (modalMode.enabled()) {
      return
    }

    checkShortcutCanRun(combo, function (canRun) {
      if (canRun) {
        fn(e, combo)
      }
    })
  }

  binding.forEach(function (keys) {
    shortcutsList.push({
      combo: keys,
      keys: keys.split('+'),
      fn: shortcutCallback,
      keyUp: options.keyUp
    })
    if (!registeredMousetrapBindings[keys]) {
      // mousetrap only allows one listener for each key combination
      // so register a single listener, and have it call all the other listeners that we have
      Mousetrap.bind(keys, function (e, combo) {
        shortcutsList.forEach(function (shortcut) {
          if (shortcut.combo === combo) {
            shortcut.fn(e, combo)
          }
        })
      }, (options.keyUp ? 'keyup' : null))
      registeredMousetrapBindings[keys] = true
    }
  })
}

function initialize () {
  webviews.bindEvent('before-input-event', function (webview, tabId, e, input) {
    var expectedKeys = 1
  // account for additional keys that aren't in the input.key property
    if (input.alt && input.key !== 'Alt') {
      expectedKeys++
    }
    if (input.shift && input.key !== 'Shift') {
      expectedKeys++
    }
    if (input.control && input.key !== 'Control') {
      expectedKeys++
    }
    if (input.meta && input.key !== 'Meta') {
      expectedKeys++
    }

    shortcutsList.forEach(function (shortcut) {
      if ((shortcut.keyUp && input.type !== 'keyUp') || (!shortcut.keyUp && input.type !== 'keyDown')) {
        return
      }
      var matches = true
      var matchedKeys = 0
      shortcut.keys.forEach(function (key) {
        if (!(
        key === input.key.toLowerCase() ||
        key === input.code.replace('Digit', '') ||
        (key === 'left' && input.key === 'ArrowLeft') ||
        (key === 'right' && input.key === 'ArrowRight') ||
        (key === 'up' && input.key === 'ArrowUp') ||
        (key === 'down' && input.key === 'ArrowDown') ||
        (key === 'alt' && (input.alt || input.key === 'Alt')) ||
        (key === 'option' && (input.alt || input.key === 'Alt')) ||
        (key === 'shift' && (input.shift || input.key === 'Shift')) ||
        (key === 'ctrl' && (input.control || input.key === 'Control')) ||
        (key === 'mod' && window.platformType === 'mac' && (input.meta || input.key === 'Meta')) ||
        (key === 'mod' && window.platformType !== 'mac' && (input.control || input.key === 'Control'))
        )
      ) {
          matches = false
        } else {
          matchedKeys++
        }
      })

      if (matches && matchedKeys === expectedKeys) {
        shortcut.fn(null, shortcut.combo)
      }
    })
  })

  defineShortcut('addTab', function () {
    /* new tabs can't be created in modal mode */
    if (modalMode.enabled()) {
      return
    }

    /* new tabs can't be created in focus mode */
    if (focusMode.enabled()) {
      focusMode.warn()
      return
    }

    browserUI.addTab()
  })

  defineShortcut('addPrivateTab', function () {
    /* new tabs can't be created in modal mode */
    if (modalMode.enabled()) {
      return
    }

    /* new tabs can't be created in focus mode */
    if (focusMode.enabled()) {
      focusMode.warn()
      return
    }

    browserUI.addTab(tabs.add({
      private: true
    }))
  })

  defineShortcut('duplicateTab', function () {
    if (modalMode.enabled()) {
      return
    }

    if (focusMode.enabled()) {
      focusMode.warn()
      return
    }

    browserUI.duplicateTab(tabs.getSelected())
  })

  defineShortcut('enterEditMode', function (e) {
    tabBar.enterEditMode(tabs.getSelected())
    return false
  })

  defineShortcut('runShortcut', function (e) {
    tabBar.enterEditMode(tabs.getSelected(), '!')
  })

  defineShortcut('closeTab', function (e) {
    browserUI.closeTab(tabs.getSelected())
  })

  defineShortcut('restoreTab', function (e) {
    if (focusMode.enabled()) {
      focusMode.warn()
      return
    }

    var restoredTab = tasks.getSelected().tabHistory.pop()

    // The tab history stack is empty
    if (!restoredTab) {
      return
    }

    browserUI.addTab(tabs.add(restoredTab), {
      enterEditMode: false
    })
  })

  defineShortcut('addToFavorites', function (e) {
    tabBar.getTab(tabs.getSelected()).querySelector('.bookmarks-button').click()
    tabBar.enterEditMode(tabs.getSelected(), null, false) // we need to show the bookmarks button, which is only visible in edit mode
  })

  // cmd+x should switch to tab x. Cmd+9 should switch to the last tab

  for (var i = 1; i < 9; i++) {
    (function (i) {
      defineShortcut({keys: 'mod+' + i}, function (e) {
        var currentIndex = tabs.getIndex(tabs.getSelected())
        var newTab = tabs.getAtIndex(currentIndex + i) || tabs.getAtIndex(currentIndex - i)
        if (newTab) {
          browserUI.switchToTab(newTab.id)
        }
      })

      defineShortcut({keys: 'shift+mod+' + i}, function (e) {
        var currentIndex = tabs.getIndex(tabs.getSelected())
        var newTab = tabs.getAtIndex(currentIndex - i) || tabs.getAtIndex(currentIndex + i)
        if (newTab) {
          browserUI.switchToTab(newTab.id)
        }
      })
    })(i)
  }

  defineShortcut('gotoLastTab', function (e) {
    browserUI.switchToTab(tabs.getAtIndex(tabs.count() - 1).id)
  })

  defineShortcut('gotoFirstTab', function (e) {
    browserUI.switchToTab(tabs.getAtIndex(0).id)
  })

  defineShortcut({keys: 'esc'}, function (e) {
    tabBar.leaveEditMode()

    // exit full screen mode
    webviews.callAsync(tabs.getSelected(), 'executeJavaScript', 'if(document.webkitIsFullScreen){document.webkitExitFullscreen()}')

    webviews.callAsync(tabs.getSelected(), 'focus')
  })

  defineShortcut('goBack', function (d) {
    webviews.get(tabs.getSelected()).goBack()
  })

  defineShortcut('goForward', function (d) {
    webviews.get(tabs.getSelected()).goForward()
  })

  defineShortcut('switchToPreviousTab', function (d) {
    var currentIndex = tabs.getIndex(tabs.getSelected())
    var previousTab = tabs.getAtIndex(currentIndex - 1)

    if (previousTab) {
      browserUI.switchToTab(previousTab.id)
    } else {
      browserUI.switchToTab(tabs.getAtIndex(tabs.count() - 1).id)
    }
  })

  defineShortcut('switchToNextTab', function (d) {
    var currentIndex = tabs.getIndex(tabs.getSelected())
    var nextTab = tabs.getAtIndex(currentIndex + 1)

    if (nextTab) {
      browserUI.switchToTab(nextTab.id)
    } else {
      browserUI.switchToTab(tabs.getAtIndex(0).id)
    }
  })

  defineShortcut('switchToNextTask', function (d) {
    const taskSwitchList = tasks.filter(t => !tasks.isCollapsed(t.id))

    const currentTaskIdx = taskSwitchList.findIndex(t => t.id === tasks.getSelected().id)

    const nextTask = taskSwitchList[currentTaskIdx + 1] || taskSwitchList[0]
    browserUI.switchToTask(nextTask.id)
  })

  defineShortcut('switchToPreviousTask', function (d) {
    const taskSwitchList = tasks.filter(t => !tasks.isCollapsed(t.id))

    const currentTaskIdx = taskSwitchList.findIndex(t => t.id === tasks.getSelected().id)
    taskCount = taskSwitchList.length

    const previousTask = taskSwitchList[currentTaskIdx - 1] || taskSwitchList[taskCount - 1]
    browserUI.switchToTask(previousTask.id)
  })

  // option+cmd+x should switch to task x

  for (var i = 1; i < 10; i++) {
    (function (i) {
      defineShortcut({keys: 'shift+option+mod+' + i}, function (e) {
        const taskSwitchList = tasks.filter(t => !tasks.isCollapsed(t.id))
        if (taskSwitchList[i - 1]) {
          browserUI.switchToTask(taskSwitchList[i - 1].id)
        }
      })
    })(i)
  }

  defineShortcut('closeAllTabs', function (d) { // destroys all current tabs, and creates a new, empty tab. Kind of like creating a new window, except the old window disappears.
    var tset = tabs.get()
    for (var i = 0; i < tset.length; i++) {
      browserUI.destroyTab(tset[i].id)
    }

    browserUI.addTab() // create a new, blank tab
  })

  var lastReload = 0

  defineShortcut('reload', function () {
    var time = Date.now()

    // pressing mod+r twice in a row reloads the whole browser
    if (time - lastReload < 500) {
      ipc.send('destroyAllViews')
      remote.getCurrentWindow().webContents.reload()
    } else if (webviews.get(tabs.getSelected()).getURL().startsWith(webviews.internalPages.error)) {
      // reload the original page rather than show the error page again
      browserUI.navigate(tabs.getSelected(), new URL(webviews.get(tabs.getSelected()).getURL()).searchParams.get('url'))
    } else {
      // this can't be an error page, use the normal reload method
      webviews.callAsync(tabs.getSelected(), 'reload')
    }

    lastReload = time
  })

  // reload the webview when the F5 key is pressed
  document.body.addEventListener('keydown', function (e) {
    if (e.keyCode === 116) {
      try {
        webviews.get(tabs.getSelected()).reloadIgnoringCache()
      } catch (e) {}
    }
  })
}

module.exports = {initialize, defineShortcut}
