import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AdminApp } from "./admin/AdminApp";
import "./index.css";

// No router dependency for two pages: the public marketing/download site at "/", and the unlisted
// root-admin license portal at "/admin" (see website/src/admin/AdminApp.tsx). A path check here
// is all that's needed — see vercel.json for the rewrite that serves index.html at both paths.
const isAdmin = window.location.pathname.startsWith("/admin");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isAdmin ? <AdminApp /> : <App />}</React.StrictMode>
);
