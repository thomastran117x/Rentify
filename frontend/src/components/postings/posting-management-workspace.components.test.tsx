import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DetailsEditor,
  FieldError,
  ListingPreview,
  PhotoUploader,
  SelectField,
  TagInput,
  TextField,
  createDefaultFormState,
} from "./posting-management-workspace";

describe("posting management form components", () => {
  it("renders field error, hint, error, types, and select changes", async () => {
    const user = userEvent.setup();
    const onTextChange = vi.fn();
    const onSelectChange = vi.fn();
    const { rerender } = render(
      <>
        <FieldError />
        <TextField
          label="Price"
          value="10"
          type="number"
          hint="Daily rate"
          onChange={onTextChange}
        />
        <SelectField label="Currency" value="CAD" onChange={onSelectChange}>
          <option value="CAD">CAD</option>
          <option value="USD">USD</option>
        </SelectField>
      </>,
    );
    expect(screen.getByText("Daily rate")).toBeInTheDocument();
    await user.clear(screen.getByRole("spinbutton"));
    await user.type(screen.getByRole("spinbutton"), "25");
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "USD" },
    });
    expect(onTextChange).toHaveBeenCalled();
    expect(onSelectChange).toHaveBeenCalledWith("USD");

    rerender(
      <TextField
        label="Price"
        value=""
        disabled
        error="Price is required"
        onChange={onTextChange}
      />,
    );
    expect(screen.getByText("Price is required")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("adds, deduplicates, blurs, and removes tags with keyboard controls", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <TagInput values={[]} onChange={onChange} placeholder="Add tag" />,
    );
    const input = screen.getByPlaceholderText("Add tag");
    await user.type(input, " studio {Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["studio"]);

    rerender(<TagInput values={["studio"]} onChange={onChange} />);
    const nextInput = screen.getByPlaceholderText("Add another…");
    await user.type(nextInput, "studio,");
    expect(onChange).not.toHaveBeenCalledWith(["studio", "studio"]);
    await user.type(nextInput, "rooftop");
    fireEvent.blur(nextInput);
    expect(onChange).toHaveBeenLastCalledWith(["studio", "rooftop"]);
    await user.clear(nextInput);
    await user.keyboard("{Backspace}");
    expect(onChange).toHaveBeenLastCalledWith([]);
    await user.click(screen.getByRole("button", { name: "Remove studio" }));
    expect(onChange).toHaveBeenLastCalledWith([]);

    rerender(<TagInput values={["locked"]} onChange={onChange} disabled />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove locked" }),
    ).not.toBeInTheDocument();
  });

  it("edits every structured detail type and manages custom attributes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const details = {
      amenities: ["wifi"],
      parking: false,
      capacity: 4,
      brand: "Example",
    };
    const { rerender } = render(
      <DetailsEditor details={details} onChange={onChange} />,
    );

    await user.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith({ ...details, parking: true });
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...details, capacity: 0 });
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "8" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...details, capacity: 8 });
    fireEvent.change(screen.getByDisplayValue("Example"), {
      target: { value: "Acme" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...details, brand: "Acme" });
    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(onChange).toHaveBeenCalledWith({
      parking: false,
      capacity: 4,
      brand: "Example",
    });

    const newName = screen.getByLabelText("New attribute name");
    await user.type(newName, "Floor Area{Enter}");
    expect(onChange).toHaveBeenCalledWith({ ...details, floor_area: "" });
    await user.type(newName, "brand");
    await user.click(screen.getByRole("button", { name: "Add attribute" }));
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ brand_2: "" }));

    rerender(<DetailsEditor details={{}} onChange={onChange} disabled />);
    expect(screen.getByText("No attributes yet. Add one below.")).toBeInTheDocument();
    expect(screen.queryByLabelText("New attribute name")).not.toBeInTheDocument();
  });

  it("renders empty and populated photo upload states and invokes controls", async () => {
    const user = userEvent.setup();
    const onAddFiles = vi.fn();
    const onRemove = vi.fn();
    const onSetPrimary = vi.fn();
    const photos = [
      { key: "one", previewUrl: "https://img/one.jpg", blobUrl: "one", blobName: "one" },
      { key: "two", previewUrl: "https://img/two.jpg", blobUrl: "two", blobName: "two" },
    ];
    const { rerender } = render(
      <PhotoUploader
        photos={[]}
        primaryKey={null}
        onAddFiles={onAddFiles}
        onRemove={onRemove}
        onSetPrimary={onSetPrimary}
        error="A photo is required"
      />,
    );
    expect(screen.getByText("No photos yet.")).toBeInTheDocument();
    expect(screen.getByText("A photo is required")).toBeInTheDocument();
    await user.upload(
      screen.getByLabelText("Upload photos"),
      new File(["a"], "one.jpg", { type: "image/jpeg" }),
    );
    expect(onAddFiles).toHaveBeenCalled();

    rerender(
      <PhotoUploader
        photos={photos}
        primaryKey="one"
        onAddFiles={onAddFiles}
        onRemove={onRemove}
        onSetPrimary={onSetPrimary}
      />,
    );
    expect(screen.getByText("Primary")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set primary" }));
    expect(onSetPrimary).toHaveBeenCalledWith("two");
    await user.click(screen.getAllByRole("button", { name: "Remove photo" })[0]);
    expect(onRemove).toHaveBeenCalledWith("one");

    rerender(
      <PhotoUploader
        photos={photos}
        primaryKey="one"
        onAddFiles={onAddFiles}
        onRemove={onRemove}
        onSetPrimary={onSetPrimary}
        disabled
      />,
    );
    expect(screen.queryByLabelText("Upload photos")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders empty and fully populated listing previews", async () => {
    const user = userEvent.setup();
    const empty = createDefaultFormState();
    empty.name = "";
    empty.city = "";
    empty.region = "";
    empty.country = "";
    empty.dailyPriceAmount = "bad";
    empty.currency = "x";
    empty.tags = [];
    empty.description = "";
    empty.details = {};
    const { rerender } = render(
      <ListingPreview form={empty} photos={[]} primaryKey={null} />,
    );
    expect(screen.getByText("No photo yet")).toBeInTheDocument();
    expect(screen.getByText("Untitled listing")).toBeInTheDocument();
    expect(screen.getByText("Location to be added")).toBeInTheDocument();

    const full = createDefaultFormState();
    full.name = "Studio";
    full.description = "A description";
    full.instantBooking = true;
    full.details = { parking: true, capacity: 4, amenities: ["wifi"] };
    const photos = [
      { key: "one", previewUrl: "https://img/one.jpg", blobUrl: "one", blobName: "one" },
      { key: "two", previewUrl: "https://img/two.jpg", blobUrl: "two", blobName: "two" },
    ];
    rerender(<ListingPreview form={full} photos={photos} primaryKey="two" />);
    expect(screen.getByAltText("Primary photo preview")).toHaveAttribute(
      "src",
      "https://img/two.jpg",
    );
    expect(screen.getByText("Instant book")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show photo 1" }));
    expect(screen.getByAltText("Primary photo preview")).toHaveAttribute(
      "src",
      "https://img/one.jpg",
    );
  });
});
