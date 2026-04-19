import { useState, useEffect } from "react";
import { ChatLayout } from "./components/ChatLayout";
import { DevPage } from "./features/DevPage";

function App() {
  const [route, setRoute] = useState(window.location.hash);

  useEffect(() => {
    const handler = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  if (route === "#dev") {
    return <DevPage />;
  }

  return <ChatLayout />;
}

export default App;
