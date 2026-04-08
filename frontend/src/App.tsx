import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { KnowledgePage } from "./pages/KnowledgePage";
import { RunHistoryPage } from "./pages/RunHistoryPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { WorkflowEditorPage } from "./pages/WorkflowEditorPage";
import { WorkflowListPage } from "./pages/WorkflowListPage";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/workflows" replace />} />
        <Route path="/workflows" element={<WorkflowListPage />} />
        <Route path="/workflows/:id" element={<WorkflowEditorPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/history" element={<RunHistoryPage />} />
      </Routes>
    </AppShell>
  );
}
