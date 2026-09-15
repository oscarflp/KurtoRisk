import React from "react";
import ReactDOM from "react-dom/client";
import { installStorageShim } from "./storage.js";
import AsteriskApp from "./App.jsx";

installStorageShim();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AsteriskApp />
  </React.StrictMode>
);
