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
        activeFileName={null}
        onFileSelected={vi.fn()}
        onSelectionCaptured={vi.fn()}
        onTabSelected={vi.fn()}
        onTabClosed={vi.fn()}
      />,
    );

    expect(screen.getByText("Open PDF")).toBeInTheDocument();
    expect(screen.getByText("Upload a PDF to start reading")).toBeInTheDocument();
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
        activeFileName="paper-a.pdf"
        onFileSelected={vi.fn()}
        onSelectionCaptured={vi.fn()}
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
