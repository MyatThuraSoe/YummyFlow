import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createIngredient,
  deleteIngredient,
  getInventory,
  getRecipes,
  getStockMovements,
  restockIngredient,
  setRecipe,
  updateIngredient,
  type DishRecipe,
  type Ingredient,
} from "@/lib/api";
import { qk, SAFETY_POLL_MS } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BookOpen,
  Loader2,
  Package,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

const REASONS = [
  { value: "RESTOCK", label: "Restock" },
  { value: "WASTE", label: "Waste" },
  { value: "ADJUSTMENT", label: "Recount" },
] as const;

const LEVEL_STYLES: Record<
  Ingredient["level"],
  { badge: "default" | "secondary" | "destructive"; icon: typeof AlertTriangle }
> = {
  OK: { badge: "default", icon: TrendingUp },
  LOW: { badge: "secondary", icon: TrendingDown },
  OUT: { badge: "destructive", icon: AlertTriangle },
};

/**
 * Stock on hand as a fraction of the reorder point.
 *
 * Capped at 100% because the question this answers is "am I about to run out",
 * not "how much do I have" — a bar that keeps growing past full tells a manager
 * nothing about the thing they opened the page to check.
 *
 * With no reorder point set there is no denominator, so an untracked ingredient
 * reads as 100%. That is wrong for an empty one: it draws a full bar directly
 * beside a red "out of stock" badge. Treat "no reorder point" as zero when the
 * jar is empty, so the bar agrees with the badge.
 */
const levelProgress = (i: Ingredient) => {
  if (i.reorderAt > 0) return Math.min(100, (i.quantity / i.reorderAt) * 100);
  return i.quantity > 0 ? 100 : 0;
};

const StockRow = ({
  ingredient,
  onRestock,
  busy,
}: {
  ingredient: Ingredient;
  onRestock: (i: Ingredient) => void;
  busy: boolean;
}) => {
  const style = LEVEL_STYLES[ingredient.level];
  const Icon = style.icon;
  const usedIn = ingredient.usedIn.length;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold">{ingredient.name}</span>
            {/* One badge, not two. An earlier version showed the raw level
                ("OUT") beside a spelled-out one ("Out of stock"), which read
                as two separate facts rather than the same one. */}
            <Badge variant={style.badge} className="text-[10px] gap-1">
              <Icon size={9} />
              {ingredient.level === "OUT"
                ? "Out of stock"
                : ingredient.level === "LOW"
                  ? "Running low"
                  : "In stock"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {usedIn > 0
              ? `Used in ${usedIn} ${usedIn === 1 ? "dish" : "dishes"}`
              : "Not used in any recipe yet"}
          </p>
        </div>

        <div className="text-right shrink-0">
          <div className="text-lg font-black tabular-nums">
            {ingredient.quantity.toFixed(2)}
            <span className="text-xs font-medium text-muted-foreground ml-1">
              {ingredient.unit}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            reorder at {ingredient.reorderAt}
          </p>
        </div>
      </div>

      {/* Colour by level, not by value: a 90%-full jar of tomatoes is still
          "fine", and a 1%-full one is not "mostly there". The shared
          `Progress` hardcodes `bg-primary` on its indicator, so the override
          has to target the indicator through the root as a descendant. */}
      <Progress
        value={levelProgress(ingredient)}
        className={cn(
          "h-1.5 [&>[data-slot=progress-indicator]]:transition-all",
          ingredient.level === "OK"
            ? "[&>[data-slot=progress-indicator]]:bg-primary"
            : ingredient.level === "LOW"
              ? "[&>[data-slot=progress-indicator]]:bg-amber-500"
              : "[&>[data-slot=progress-indicator]]:bg-destructive",
        )}
      />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onRestock(ingredient)}
        >
          Adjust stock
        </Button>
        {usedIn > 0 && (
          <span className="text-[11px] text-muted-foreground truncate">
            {ingredient.usedIn
              .slice(0, 3)
              .map((u) => u.name)
              .join(", ")}
            {usedIn > 3 && ` +${usedIn - 3} more`}
          </span>
        )}
      </div>
    </div>
  );
};

const IngredientsTab = () => {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [adding, setAdding] = useState(false);
  const [adjusting, setAdjusting] = useState<Ingredient | null>(null);

  // Draft form state. Kept as one object so Add and Edit share a form.
  const [form, setForm] = useState({
    name: "",
    unit: "kg",
    quantity: "0",
    reorderAt: "0",
  });
  const [adjust, setAdjust] = useState({
    delta: "",
    reason: "RESTOCK" as (typeof REASONS)[number]["value"],
    note: "",
  });

  const { data, isPending } = useQuery({
    queryKey: qk.inventory.ingredients,
    queryFn: async () => await getInventory(),
    // Stock moves on every order, so this is socket-driven with a long net.
    refetchInterval: SAFETY_POLL_MS,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: qk.inventory.all });

  const createMutation = useMutation({
    mutationFn: () =>
      createIngredient({
        name: form.name.trim(),
        unit: form.unit.trim() || undefined,
        quantity: Number(form.quantity) || 0,
        reorderAt: Number(form.reorderAt) || 0,
      }),
    onSuccess: async () => {
      await invalidate();
      setAdding(false);
      setForm({ name: "", unit: "kg", quantity: "0", reorderAt: "0" });
      toast.success("Ingredient added.");
    },
    onError: (e: Error) => toast.error(e.message || "Could not add ingredient."),
  });

  const updateMutation = useMutation({
    mutationFn: (v: { id: string }) =>
      updateIngredient({
        id: v.id,
        name: form.name.trim(),
        unit: form.unit.trim() || undefined,
        reorderAt: Number(form.reorderAt) || 0,
      }),
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
      toast.success("Ingredient updated.");
    },
    onError: (e: Error) => toast.error(e.message || "Could not update."),
  });

  const restockMutation = useMutation({
    mutationFn: (v: { id: string }) =>
      restockIngredient({
        id: v.id,
        delta: Number(adjust.delta),
        reason: adjust.reason,
        note: adjust.note.trim() || undefined,
      }),
    onSuccess: async () => {
      await invalidate();
      setAdjusting(null);
      setAdjust({ delta: "", reason: "RESTOCK", note: "" });
      toast.success("Stock level adjusted.");
    },
    onError: (e: Error) => toast.error(e.message || "Could not adjust stock."),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => deleteIngredient({ id }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Ingredient removed.");
    },
    onError: (e: Error) => toast.error(e.message || "Could not remove."),
  });

  const visible = useMemo(() => {
    const list = data?.data ?? [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((i) => i.name.toLowerCase().includes(needle));
  }, [data, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter ingredients"
          className="max-w-xs"
        />
        <div className="ml-auto flex items-center gap-2">
          {data && data.counts.low > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle size={10} />
              {data.counts.low} low or out
            </Badge>
          )}
          <Button
            size="sm"
            onClick={() => {
              setAdding((v) => !v);
              setEditing(null);
            }}
          >
            <Plus size={14} />
            Add ingredient
          </Button>
        </div>
      </div>

      {(adding || editing) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {editing ? `Edit ${editing.name}` : "New ingredient"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!form.name.trim()) return toast.error("Name is required.");
                if (editing) updateMutation.mutate({ id: editing.id });
                else createMutation.mutate();
              }}
              className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end"
            >
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="ing-name">Name</Label>
                <Input
                  id="ing-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Tomatoes"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ing-unit">Unit</Label>
                <Input
                  id="ing-unit"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  placeholder="kg, L, pcs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ing-reorder">Reorder at</Label>
                <Input
                  id="ing-reorder"
                  type="number"
                  step="any"
                  value={form.reorderAt}
                  onChange={(e) => setForm({ ...form, reorderAt: e.target.value })}
                />
              </div>
              {!editing && (
                <div className="space-y-1.5">
                  <Label htmlFor="ing-qty">Starting quantity</Label>
                  <Input
                    id="ing-qty"
                    type="number"
                    step="any"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  />
                </div>
              )}
              <div className="flex gap-2 col-span-full">
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    createMutation.isPending || updateMutation.isPending
                  }
                >
                  {createMutation.isPending || updateMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : null}
                  {editing ? "Save changes" : "Add"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAdding(false);
                    setEditing(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {adjusting && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Adjust {adjusting.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const delta = Number(adjust.delta);
                if (!delta) return toast.error("Enter a non-zero amount.");
                if (adjusting.quantity + delta < 0)
                  return toast.error(
                    `That would take stock below zero (currently ${adjusting.quantity} ${adjusting.unit}).`,
                  );
                restockMutation.mutate({ id: adjusting.id });
              }}
              className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end"
            >
              <div className="space-y-1.5">
                <Label htmlFor="adj-delta">
                  Change ({adjusting.unit})
                </Label>
                <Input
                  id="adj-delta"
                  type="number"
                  step="any"
                  // Positive adds (a delivery), negative removes (spoilage).
                  // The sign is the whole meaning of this field, so the
                  // placeholder has to say which way is which.
                  placeholder="e.g. 5 or -2"
                  value={adjust.delta}
                  onChange={(e) => setAdjust({ ...adjust, delta: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adj-reason">Reason</Label>
                <select
                  id="adj-reason"
                  value={adjust.reason}
                  onChange={(e) =>
                    setAdjust({
                      ...adjust,
                      reason: e.target.value as (typeof REASONS)[number]["value"],
                    })
                  }
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="adj-note">Note (optional)</Label>
                <Input
                  id="adj-note"
                  value={adjust.note}
                  onChange={(e) => setAdjust({ ...adjust, note: e.target.value })}
                  placeholder="Supplier, spoilage reason…"
                />
              </div>
              <div className="flex gap-2 col-span-full">
                <Button
                  type="submit"
                  size="sm"
                  disabled={restockMutation.isPending}
                >
                  {restockMutation.isPending && (
                    <Loader2 size={14} className="animate-spin" />
                  )}
                  Record movement
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setAdjusting(null)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isPending ? (
            <div className="flex justify-center py-12">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Package
                size={20}
                className="mx-auto text-muted-foreground/40 mb-2"
              />
              <p className="font-medium">
                {filter ? "No matching ingredient" : "No ingredients tracked yet"}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {filter
                  ? "Try a different name."
                  : "Add your first ingredient to start tracking stock and recipes."}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {visible.map((i) => (
                <div key={i.id} className="group relative">
                  <StockRow
                    ingredient={i}
                    busy={restockMutation.isPending}
                    onRestock={(ing) => {
                      setAdjusting(ing);
                      setAdjust({ delta: "", reason: "RESTOCK", note: "" });
                    }}
                  />
                  {/* Actions stay hidden until hover: they are the destructive
                      path, and a wall of buttons on every row is how the
                      "Adjust stock" primary action gets misclicked. */}
                  <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => {
                        setEditing(i);
                        setAdding(false);
                        setForm({
                          name: i.name,
                          unit: i.unit,
                          quantity: String(i.quantity),
                          reorderAt: String(i.reorderAt),
                        });
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-destructive hover:text-destructive"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate({ id: i.id })}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const IngredientGrid = ({
  ingredients,
  draft,
  onChange,
}: {
  ingredients: Ingredient[];
  draft: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}) => (
  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
    {ingredients.map((ing) => (
      <label key={ing.id} className="flex items-center gap-2 text-sm">
        <span className="flex-1 truncate text-muted-foreground">
          {ing.name}
        </span>
        {/* The suffix is load-bearing: the number alone is ambiguous without
            knowing it is per-serving, in the ingredient's own unit. */}
        <div className="relative w-24 shrink-0">
          <Input
            type="number"
            step="any"
            min={0}
            value={draft[ing.id] ?? 0}
            onChange={(e) =>
              onChange({ ...draft, [ing.id]: Number(e.target.value) })
            }
            className="h-8 pr-9"
            aria-label={`${ing.name} per serving`}
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">
            {ing.unit}
          </span>
        </div>
      </label>
    ))}
  </div>
);

const RecipesTab = () => {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});

  // Its own key. This used to share `qk.inventory.ingredients` with the
  // InventoryTab above while returning a DIFFERENT shape — the bare
  // `.data` array rather than the `{ ingredients, lowStock }` envelope — so
  // whichever tab mounted last overwrote the other's cache entry and the other
  // read the wrong shape (a hard crash on `data.lowStock.length`). Identical
  // key + different return type is the whole bug.
  const { data: ingredients = [] } = useQuery({
    queryKey: qk.inventory.ingredientList,
    // `getInventory()` resolves to the full `{ data, lowStock, counts }`
    // envelope; this tab wants only the `data` array out of it.
    queryFn: async () => (await getInventory()).data,
  });

  // The endpoint returns every menu item, recipe or not — "no recipe" is a
  // state a manager needs to see, not a gap to paper over. So there is no
  // second request for the unrecipe'd remainder.
  const { data: recipes = [], isPending } = useQuery({
    queryKey: qk.inventory.recipes,
    queryFn: async () => (await getRecipes()).data,
  }); // see note below: ingredients are fetched separately with their own key

  const missing = useMemo(
    () => recipes.filter((r) => r.ingredientCount === 0).length,
    [recipes],
  );

  const saveMutation = useMutation({
    mutationFn: (menuItemId: string) =>
      setRecipe({
        menuItemId,
        // A line left at 0 is dropped rather than saved, so removing the last
        // bit of an ingredient clears the line instead of storing a 0 that
        // would divide-by-zero at the till.
        items: Object.entries(draft)
          .filter(([, qty]) => Number(qty) > 0)
          .map(([ingredientId, qty]) => ({ ingredientId, quantity: qty })),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.inventory.all });
      setOpenId(null);
      setDraft({});
      toast.success("Recipe saved.");
    },
    onError: (e: Error) => toast.error(e.message || "Could not save recipe."),
  });

  const open = (recipe: DishRecipe) => {
    if (openId === recipe.id) {
      setOpenId(null);
      return;
    }
    setOpenId(recipe.id);
    // Seed the draft from the saved recipe so "open, change one number, save"
    // does not silently zero every other line.
    setDraft(
      Object.fromEntries(recipe.items.map((i) => [i.ingredientId, i.perServing])),
    );
  };

  if (isPending) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Per-serving quantities deducted from stock when the dish is sold.{" "}
        {missing > 0 ? (
          <>
            <span className="font-medium text-foreground">
              {missing} {missing === 1 ? "dish has" : "dishes have"} no recipe
            </span>{" "}
            and will sell without deducting stock.
          </>
        ) : (
          "Every dish has a recipe."
        )}
      </p>

      {recipes.length === 0 ? (
        <div className="text-center py-12 px-4">
          <BookOpen size={20} className="mx-auto text-muted-foreground/40 mb-2" />
          <p className="font-medium">No dishes yet</p>
        </div>
      ) : (
        recipes.map((recipe: DishRecipe) => {
          const expanded = openId === recipe.id;
          return (
            <Card key={recipe.id}>
              <button
                className="w-full text-left p-4 flex items-center justify-between gap-3"
                onClick={() => open(recipe)}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold">{recipe.name}</span>
                    {recipe.ingredientCount === 0 ? (
                      <Badge variant="secondary" className="text-[10px]">
                        no recipe
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        {recipe.ingredientCount}{" "}
                        {recipe.ingredientCount === 1 ? "ingredient" : "ingredients"}
                      </Badge>
                    )}
                    {!recipe.isAvailable && (
                      <Badge variant="secondary" className="text-[10px]">
                        hidden
                      </Badge>
                    )}
                  </div>
                  {recipe.items.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {recipe.items.map((i) => i.name).join(", ")}
                    </p>
                  )}
                </div>
                <BookOpen
                  size={16}
                  className="text-muted-foreground shrink-0"
                />
              </button>

              {expanded && (
                <CardContent className="border-t pt-4 space-y-4">
                  {/* Show what the current stock can still support before the
                      editor, so a manager sees the consequence of the recipe
                      they are about to set, not just the numbers they typed. */}
                  {recipe.items.length > 0 && (
                    <div className="space-y-1">
                      {recipe.items.map((line) => {
                        const short =
                          line.servingsLeft !== null && line.servingsLeft <= 0;
                        return (
                          <div
                            key={line.ingredientId}
                            className="flex items-center justify-between text-sm py-0.5"
                          >
                            <span className="text-muted-foreground truncate">
                              {line.name}
                            </span>
                            <span className="flex items-center gap-3 tabular-nums shrink-0">
                              <span className="text-xs text-muted-foreground">
                                {line.onHand} {line.unit} on hand
                              </span>
                              <Badge
                                variant={short ? "destructive" : "outline"}
                                className="text-[10px]"
                              >
                                {line.servingsLeft === null
                                  ? `${line.perServing} ${line.unit}`
                                  : short
                                    ? "cannot be made"
                                    : `${line.servingsLeft} servings left`}
                              </Badge>
                            </span>
                          </div>
                        );
                      })}
                      <Separator />
                    </div>
                  )}

                  {ingredients.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Add ingredients on the Stock tab first.
                    </p>
                  ) : (
                    <>
                      <IngredientGrid
                        ingredients={ingredients}
                        draft={draft}
                        onChange={setDraft}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={saveMutation.isPending}
                          onClick={() => saveMutation.mutate(recipe.id)}
                        >
                          {saveMutation.isPending && (
                            <Loader2 size={14} className="animate-spin" />
                          )}
                          Save recipe
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOpenId(null)}
                        >
                          Close
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
};

const MovementsTab = () => {
  const { data = [], isPending } = useQuery({
    queryKey: qk.inventory.movements(50),
    queryFn: async () => (await getStockMovements(50)).data,
  });

  return (
    <Card>
      <CardContent className="p-0">
        {isPending ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-12 px-4">
            <p className="font-medium">No stock movements yet</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Every deduction and correction will be recorded here.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[70vh] w-full">
            <div className="divide-y">
              {data.map((m) => (
                <div
                  key={m.id}
                  className="p-3 flex items-center gap-3 text-sm"
                >
                  {/* Sign as colour: a movement's whole purpose is direction. */}
                  <span
                    className={`font-black tabular-nums w-16 text-right shrink-0 ${
                      m.delta < 0 ? "text-destructive" : "text-primary"
                    }`}
                  >
                    {m.delta > 0 ? "+" : ""}
                    {m.delta.toFixed(2)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{m.ingredient}</div>
                    <p className="text-xs text-muted-foreground">
                      {m.reason.replace("_", " ").toLowerCase()}
                      {m.note ? ` — ${m.note}` : ""}
                      {m.orderId ? " · from an order" : ""}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {m.unit} · {new Date(m.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};

const Inventory = () => {
  const { data } = useQuery({
    queryKey: qk.inventory.ingredients,
    queryFn: async () => await getInventory(),
  });

  return (
    <div className="space-y-4">
      {data && data.lowStock.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <AlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />
          <div className="text-sm">
            <span className="font-bold">Needs reordering: </span>
            <span className="text-muted-foreground">
              {data.lowStock.join(", ")}
            </span>
          </div>
        </div>
      )}

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="recipes">Recipes</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
        </TabsList>
        <TabsContent value="stock">
          <IngredientsTab />
        </TabsContent>
        <TabsContent value="recipes">
          <RecipesTab />
        </TabsContent>
        <TabsContent value="movements">
          <MovementsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Inventory;
