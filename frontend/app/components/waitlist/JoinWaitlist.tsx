import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getPublicWaitlist, joinWaitlist } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Loader2, Users } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

const formatWait = (minutes: number) => {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
};

/**
 * Public, unauthenticated queue join.
 *
 * No account is required — a walk-in standing at the door is the entire point.
 * The page only ever shows aggregate depth, never who else is waiting: a queue
 * board is not a directory of other guests' names and phone numbers.
 */
const JoinWaitlist = () => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [guests, setGuests] = useState("2");
  const [notes, setNotes] = useState("");

  const { data, isPending: loadingDepth } = useQuery({
    queryKey: qk.waitlist.public,
    queryFn: async () => (await getPublicWaitlist()).data,
    // Queue depth is the whole reason to open this page; it must not be a
    // snapshot from twenty minutes ago.
    refetchInterval: 30_000,
  });

  const joinMutation = useMutation({
    mutationFn: () =>
      joinWaitlist({
        customerName: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        guests: Number(guests),
        notes: notes.trim() || undefined,
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: qk.waitlist.public });
      toast.success(
        `${res.data.customerName}, you're number ${res.data.position} in the queue.`,
        { duration: 6000 },
      );
    },
    onError: (e: Error) => toast.error(e.message || "Could not join the queue."),
  });

  const partySize = Number(guests) || 0;
  // Rough, honest guidance: what the host is seeing right now. Not a promise —
  // the page says so, because a quote nobody can keep is worse than no quote.
  const estimate =
    data?.averageWaitMinutes != null
      ? Math.round((data.averageWaitMinutes / 2) * partySize)
      : null;

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Where things stand</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-black tabular-nums">
              {loadingDepth ? "—" : (data?.partiesAhead ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground">parties ahead</p>
          </div>
          <div>
            <div className="text-2xl font-black tabular-nums">
              {loadingDepth ? "—" : (data?.coversAhead ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground">covers ahead</p>
          </div>
          <div>
            <div className="text-2xl font-black tabular-nums">
              {loadingDepth
                ? "—"
                : data?.averageWaitMinutes != null
                  ? formatWait(data.averageWaitMinutes)
                  : "—"}
            </div>
            <p className="text-xs text-muted-foreground">typical wait</p>
          </div>
        </CardContent>
      </Card>

      {data && data.longestWaitMinutes >= 45 && (
        <p className="text-sm text-muted-foreground text-center">
          <Clock size={12} className="inline mr-1 -mt-0.5" />
          It's a busy night — the longest party has been waiting{" "}
          {formatWait(data.longestWaitMinutes)}.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Join the queue</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return toast.error("Please tell us your name.");
              if (partySize < 1 || partySize > 20)
                return toast.error("Party size must be between 1 and 20.");
              joinMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="wl-name">Name</Label>
              <Input
                id="wl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Who should we call?"
                required
                autoComplete="name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="wl-guests">Party size</Label>
              <div className="relative">
                <Users
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="wl-guests"
                  type="number"
                  min={1}
                  max={20}
                  value={guests}
                  onChange={(e) => setGuests(e.target.value)}
                  className="pl-8"
                  required
                />
              </div>
              {estimate !== null && estimate > 0 && (
                <p className="text-xs text-muted-foreground">
                  A party of {partySize} is typically waiting about{" "}
                  {formatWait(estimate)}.
                </p>
              )}
            </div>

            {/* Phone is what the host actually calls. The email is only used
                to send a "your table is ready" note, so both are optional. */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="wl-phone">Phone (optional)</Label>
                <Input
                  id="wl-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="For 'your table is ready'"
                  autoComplete="tel"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wl-email">Email (optional)</Label>
                <Input
                  id="wl-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="For a text nudge"
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wl-notes">Notes (optional)</Label>
              <Textarea
                id="wl-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="High chair, accessibility needs, allergies…"
                rows={2}
                maxLength={500}
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={joinMutation.isPending || data?.accepting === false}
            >
              {joinMutation.isPending && <Loader2 size={14} className="animate-spin" />}
              {data?.accepting === false
                ? "Not taking walk-ins right now"
                : "Join the queue"}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Estimates are based on tonight so far, not a promise. Keep your
              phone nearby — the host will come find you.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default JoinWaitlist;
