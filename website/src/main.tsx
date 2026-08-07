import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AdminApp } from "./admin/AdminApp";
import { ProductSpec } from "./components/ProductSpec";
import "./index.css";

// No router dependency for three pages: the public marketing/download site at "/", the unlisted
// root-admin license portal at "/admin" (see website/src/admin/AdminApp.tsx), and the product
// specification page at "/product-specification". A path check here is all that's needed — see
// vercel.json for the rewrites that serve index.html at each path.
const path = window.location.pathname;

function page() {
  if (path.startsWith("/admin")) return <AdminApp />;
  if (path.startsWith("/product-specification")) return <ProductSpec />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode>{page()}</React.StrictMode>);
