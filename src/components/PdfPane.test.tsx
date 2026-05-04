import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfPane } from "./PdfPane";

describe("PdfPane", () => {
  it("renders the upload shell without crashing", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <PdfPane
        tabs={[]}
        activeTabId={null}
        activeFileUrl={null}
        onFileSelected={vi.fn()}
        onSelectionCaptured={vi.fn()}
        onContextSelection={vi.fn()}
        onTabSelected={vi.fn()}
        onTabClosed={vi.fn()}
      />,
    );

    expect(screen.getByText("打开 PDF")).toBeInTheDocument();
    // The empty-state hero is now a drop zone with a clearer CTA + a fallback button.
    expect(screen.getByText("把 PDF 拖到这里")).toBeInTheDocument();
    expect(screen.getByText("选择 PDF 文件")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("renders PDF tabs and forwards tab actions", () => {
    const onTabSelected = vi.fn();
    const onTabClosed = vi.fn();

    render(
      <PdfPane
        tabs={[
          { id: "tab-1", fileName: "paper-a.pdf" },
          { id: "tab-2", fileName: "paper-b.pdf" },
        ]}
        activeTabId="tab-1"
        activeFileUrl={null}
        onFileSelected={vi.fn()}
        onSelectionCaptured={vi.fn()}
        onContextSelection={vi.fn()}
        onTabSelected={onTabSelected}
        onTabClosed={onTabClosed}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "paper-b.pdf" }));
    expect(onTabSelected).toHaveBeenCalledWith("tab-2");

    fireEvent.click(screen.getByRole("button", { name: "Close paper-a.pdf" }));
    expect(onTabClosed).toHaveBeenCalledWith("tab-1");
  });
});
