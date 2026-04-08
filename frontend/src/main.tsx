import React from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider, theme } from "antd";
import "antd/dist/reset.css";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 8
        }
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
);
