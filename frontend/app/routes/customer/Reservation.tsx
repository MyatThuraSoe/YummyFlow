import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { customFetch, createReservation } from "@/lib/api";
import { format } from "date-fns";
import {
  CalendarIcon,
  Clock,
  Users,
  Loader2,
  CheckCircle2,
  Phone,
  Mail,
  User,
  MapPin,
  ArrowLeft,
  Home,
} from "lucide-react";
import toast from "react-hot-toast";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TablesProps } from "@/type";
import { Link } from "react-router";
import type { Route } from "../+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Make Reservation" },
    { name: "description", content: "Welcome to Make Reservation Page!" },
  ];
}
const Reservation = () => {
  const [step, setStep] = useState(1);
  const [isSuccess, setIsSuccess] = useState(false);

  // Form State
  const [date, setDate] = useState<Date>();
  const [time, setTime] = useState<string>("");
  const [guests, setGuests] = useState<string>("2");
  const [selectedTable, setSelectedTable] = useState<string>("");

  // Customer Details
  const [name, setName] = useState<string>("");
  const [phone, setPhone] = useState<string>(""); // Great for M-Pesa / Kenya context
  // PRO: optional — lets guest bookings (no account) receive the confirmation
  // email. Signed-in users fall back to their account email server-side.
  const [email, setEmail] = useState<string>("");
  const [specialRequests, setSpecialRequests] = useState<string>("");

  // Fetch available tables
  const { data: tables = [], isLoading: isLoadingTables } = useQuery<
    TablesProps[]
  >({
    queryKey: ["public-tables"],
    queryFn: () => customFetch("/tables"),
  });

  const bookMutation = useMutation({
    mutationFn: createReservation,
    onSuccess: () => {
      setIsSuccess(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (error: any) => {
      // Three failures mean three very different things to someone trying to
      // book a table, and a single generic "failed" for all of them is what
      // makes a booking form feel broken rather than busy.
      const status = error?.status;

      if (status === 409) {
        // Lost the race for this table — someone else took that slot moments
        // earlier. Nothing is wrong with what they typed, so keep their details
        // and send them back to the time picker with the table cleared.
        setSelectedTable("");
        setStep(1);
        toast.error(
          "That table was just taken for this time slot. Please pick another time or table.",
          { duration: 6000 },
        );
        return;
      }

      if (status === 429) {
        const wait = error?.retryAfterSeconds;
        toast.error(
          wait
            ? `Too many booking attempts. Please try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? "s" : ""}.`
            : "Too many booking attempts. Please try again shortly.",
          { duration: 8000 },
        );
        return;
      }

      if (status === 403 || status === 401) {
        toast.error("Please sign in before booking a table.");
        return;
      }

      toast.error(
        error?.message || "Failed to book table. Please try another time.",
      );
    },
  });

  // Filter tables to only show ones that fit the party size
  const suitableTables = useMemo(() => {
    if (!tables) return [];
    const guestCount = parseInt(guests) || 1;
    // Show tables that fit the guests, plus a small buffer (e.g., 4 guests can sit at a 6-seater, but not a 2-seater)
    return tables.filter(
      (t) => t.seats >= guestCount && t.seats <= guestCount + 2,
    );
  }, [tables, guests]);

  const handleBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !time || !selectedTable || !name) {
      return toast.error("Please fill in all required fields");
    }

    const [hours, minutes] = time.split(":");
    const reservationDate = new Date(date);
    reservationDate.setHours(parseInt(hours), parseInt(minutes), 0);

    // If you added Phone/SpecialRequests to your Prisma schema, pass them here!
    bookMutation.mutate({
      customerName: name,
      date: reservationDate.toISOString(),
      guests: parseInt(guests),
      tableId: selectedTable,
      email: email.trim() || undefined,
    });
  };

  // ========================================================
  // SUCCESS SCREEN
  // ========================================================
  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fc] dark:bg-background p-4 rounded-lg">
        <div className="max-w-md w-full bg-white dark:bg-card rounded-3xl shadow-xl p-8 text-center border border-border">
          <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 mx-auto rounded-full flex items-center justify-center mb-6">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h2 className="text-3xl font-black uppercase tracking-tight text-foreground mb-4">
            Table Confirmed!
          </h2>
          <p className="text-muted-foreground mb-8">
            Thank you, <span className="font-bold text-foreground">{name}</span>
            . Your table is reserved for{" "}
            <span className="font-bold text-foreground">
              {date && format(date, "PPP")}
            </span>{" "}
            at{" "}
            <span className="font-bold text-foreground">
              {time &&
                format(
                  new Date().setHours(
                    parseInt(time.split(":")[0]),
                    parseInt(time.split(":")[1]),
                  ),
                  "h:mm a",
                )}
            </span>
            .
          </p>
          <Button
            onClick={() => (window.location.href = "/")}
            className="w-full h-14 rounded-2xl font-bold uppercase tracking-widest"
          >
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[96vh] flex border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900">
      {/* LEFT COLUMN: Image / Branding (Hidden on mobile) */}
      <div className="hidden lg:flex w-1/2 relative bg-primary items-center justify-center p-12 overflow-hidden rounded-l-lg">
        {/* Replace this div with an actual <img> of your restaurant! */}
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center opacity-40 mix-blend-overlay" />
        <div className="relative z-10 text-white max-w-lg">
          <h1 className="text-5xl font-black uppercase tracking-tighter mb-6 leading-tight">
            Experience <br /> Exceptional <br /> Dining.
          </h1>
          <p className="text-primary-foreground/80 text-lg mb-8 font-medium">
            Reserve your table in advance and skip the wait. We're excited to
            host you.
          </p>
          <div className="flex items-center gap-4 text-sm font-semibold">
            <MapPin className="w-5 h-5" />
            Nairobi CBD, Kenya
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: The Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 overflow-y-auto">
        <Link
          to={"/"}
          className={cn(
            "absolute top-8 right-[80%] lg:right-[43%] py-5 px-4",
            buttonVariants({ variant: "default" }),
          )}
        >
          <Home />
          Home
        </Link>
        <div className="max-w-md w-full pt-10 lg:pt-0">
          <div className="mb-8">
            <h2 className="text-3xl font-black uppercase tracking-tight text-foreground">
              Book a Table
            </h2>
            <p className="text-muted-foreground mt-2">Step {step} of 2</p>
          </div>
          <form onSubmit={handleBooking} className="space-y-6">
            {/* --- STEP 1: Date & Time --- */}
            <div
              className={cn(
                "space-y-6 transition-all duration-300",
                step === 2 && "hidden",
              )}
            >
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Party Size
                </Label>
                <Select
                  value={guests}
                  onValueChange={(val) => {
                    setGuests(val);
                    setSelectedTable("");
                  }}
                >
                  <SelectTrigger className="h-14 rounded-2xl bg-white dark:bg-muted shadow-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <Users className="h-5 w-5 text-primary" />
                      <SelectValue placeholder="Number of guests" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 8, 10].map((num) => (
                      <SelectItem key={num} value={num.toString()}>
                        {num} {num === 1 ? "Guest" : "Guests"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Date
                  </Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full h-14 rounded-lg justify-start text-left font-medium bg-white dark:bg-muted shadow-sm border-border",
                          !date && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-5 w-5 text-primary" />
                        {date ? (
                          format(date, "MMM dd, yyyy")
                        ) : (
                          <span>Select Date</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-auto p-0 border-border rounded-lg"
                      align="start"
                    >
                      <Calendar
                        mode="single"
                        selected={date}
                        onSelect={setDate}
                        disabled={(date) =>
                          date < new Date(new Date().setHours(0, 0, 0, 0))
                        }
                        // initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Time
                  </Label>
                  <Select value={time} onValueChange={setTime}>
                    <SelectTrigger className="h-full w-full rounded-lg bg-white dark:bg-muted shadow-sm font-medium py-[26.5px]">
                      <div className="flex items-center gap-2">
                        <Clock className="h-5 w-5 text-primary" />
                        <SelectValue placeholder="Time" />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 23 }).map((_, i) => {
                        const hour = Math.floor(i / 2) + 11; // Starts at 11:00 AM
                        const minute = i % 2 === 0 ? "00" : "30";
                        const timeStr = `${hour.toString().padStart(2, "0")}:${minute}`;
                        return (
                          <SelectItem key={timeStr} value={timeStr}>
                            {format(
                              new Date().setHours(hour, parseInt(minute)),
                              "h:mm a",
                            )}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Select a Table Area
                </Label>
                <Select
                  value={selectedTable}
                  onValueChange={setSelectedTable}
                  disabled={isLoadingTables || !date || !time}
                >
                  <SelectTrigger className="h-14 w-full rounded-lg bg-white dark:bg-muted shadow-sm font-medium">
                    <SelectValue
                      placeholder={
                        !date || !time
                          ? "Pick date & time first"
                          : "Choose an available table"
                      }
                    />
                  </SelectTrigger>

                  {/* FIX 1: Removed className="relative" so it floats correctly! */}
                  <SelectContent z-index={50}>
                    {/* FIX 2: Changed !== to === 0 */}
                    {suitableTables.length === 0 ? (
                      <SelectItem value="none" disabled>
                        No tables fit this party size
                      </SelectItem>
                    ) : (
                      suitableTables.map((table) => (
                        <SelectItem key={table.id} value={table.id}>
                          {table.section} (Table {table.name})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                onClick={() => setStep(2)}
                className="w-full h-14 rounded-2xl font-bold uppercase tracking-widest mt-8"
                disabled={!date || !time || !guests || !selectedTable}
              >
                Next Step
              </Button>
            </div>

            {/* --- STEP 2: Customer Details --- */}
            <div
              className={cn(
                "space-y-6 transition-all duration-300",
                step === 1 && "hidden",
              )}
            >
              <div className="space-y-2">
                <Label
                  htmlFor="name"
                  className="text-xs font-bold uppercase tracking-widest text-muted-foreground"
                >
                  Full Name
                </Label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="name"
                    placeholder="Enter your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-14 pl-12 rounded-2xl bg-white dark:bg-muted shadow-sm border-border"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="phone"
                  className="text-xs font-bold uppercase tracking-widest text-muted-foreground"
                >
                  Phone Number
                </Label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="phone"
                    placeholder="07XX XXX XXX"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="h-14 pl-12 rounded-2xl bg-white dark:bg-muted shadow-sm border-border"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="email"
                  className="text-xs font-bold uppercase tracking-widest text-muted-foreground"
                >
                  Email (Optional)
                </Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="email"
                    placeholder="you@example.com"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-14 pl-12 rounded-2xl bg-white dark:bg-muted shadow-sm border-border"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  We'll email your booking confirmation here.
                </p>
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="requests"
                  className="text-xs font-bold uppercase tracking-widest text-muted-foreground"
                >
                  Special Requests (Optional)
                </Label>
                <Input
                  id="requests"
                  placeholder="Allergies, high chair needed..."
                  value={specialRequests}
                  onChange={(e) => setSpecialRequests(e.target.value)}
                  className="h-14 rounded-2xl bg-white dark:bg-muted shadow-sm border-border"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="h-14 rounded-2xl font-bold uppercase px-8"
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  disabled={bookMutation.isPending || !name || !phone}
                  className="flex-1 h-14 rounded-2xl font-bold uppercase tracking-widest"
                >
                  {bookMutation.isPending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Confirm Booking"
                  )}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Reservation;
