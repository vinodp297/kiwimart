"use client";

import { Input, Textarea, Select } from "@/components/ui/primitives";
import CATEGORIES from "@/data/categories";
import { CONDITIONS } from "./sell-types";
import type { Condition } from "./sell-types";

interface SellStep2DetailsProps {
  title: string;
  description: string;
  categoryId: string;
  subcategory: string;
  condition: Condition | "";
  errors: Record<string, string>;
  onTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDescriptionChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onCategoryChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onSubcategoryChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onConditionChange: (value: Condition) => void;
}

export default function SellStep2Details({
  title,
  description,
  categoryId,
  subcategory,
  condition,
  errors,
  onTitleChange,
  onDescriptionChange,
  onCategoryChange,
  onSubcategoryChange,
  onConditionChange,
}: SellStep2DetailsProps) {
  const activeCat = CATEGORIES.find((c) => c.id === categoryId);

  return (
    <div className="p-6 space-y-5">
      <h2
        className="font-[family-name:var(--font-playfair)] text-[1.15rem]
        font-semibold text-[#141414]"
      >
        Item details
      </h2>

      <Input
        label="Title"
        value={title}
        onChange={onTitleChange}
        placeholder="e.g. Sony WH-1000XM5 Noise-Cancelling Headphones"
        maxLength={100}
        required
        error={errors.title}
        hint={`${title.length}/100 · Be specific — include brand, model and key specs`}
      />

      <Textarea
        label="Description"
        value={description}
        onChange={onDescriptionChange}
        placeholder="Describe the item's condition, what's included, any issues, reason for selling..."
        required
        error={errors.description}
        charCount={{ current: description.length, max: 3000 }}
        className="min-h-[140px]"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select
          label="Category"
          value={categoryId}
          onChange={onCategoryChange}
          placeholder="Select category"
          required
          error={errors.category}
        >
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </Select>

        {activeCat && (
          <Select
            label="Subcategory"
            value={subcategory}
            onChange={onSubcategoryChange}
            placeholder="Select subcategory"
          >
            {activeCat.subcategories.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
      </div>

      {/* Condition selector */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[12.5px] font-semibold text-[#141414]">
          Condition <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {CONDITIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => onConditionChange(c.value)}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2
                text-center transition-all duration-150
                ${
                  condition === c.value
                    ? "border-[#141414] bg-[#141414] text-white"
                    : "border-[#E3E0D9] hover:border-[#C9C5BC] text-[#73706A]"
                }`}
            >
              <span className="text-[11.5px] font-semibold">{c.label}</span>
              <span
                className={`text-[10px] leading-tight ${condition === c.value ? "text-white/70" : "text-[#9E9A91]"}`}
              >
                {c.hint}
              </span>
            </button>
          ))}
        </div>
        {errors.condition && (
          <p className="text-[11.5px] text-red-500 font-medium">
            {errors.condition}
          </p>
        )}
      </div>
    </div>
  );
}
