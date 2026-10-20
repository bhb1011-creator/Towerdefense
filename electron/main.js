"use strict";

// Startpunkt der Mac-App: öffnet das Spiel (index.html) in einem eigenen Fenster.
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    title: "Neo-City Defense",
    backgroundColor: "#0d0920",
    webPreferences: { contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, "..", "index.html"));
  // Links nach außen im normalen Browser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
