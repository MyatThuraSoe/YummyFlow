import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { Navigate } from "react-router";
import toast from "react-hot-toast";

const Socials = ({
  isLoading,
  setIsLoading,
}: {
  isLoading: boolean;
  setIsLoading: (isLoading: boolean) => void;
}) => {
  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    await authClient.signIn.social(
      {
        provider: "google",
        callbackURL: "http://localhost:5173", // ✨ The Magic Redirect!
        errorCallbackURL: "http://localhost:5173/signin?error=true", // Where to go if they cancel
      },
      {
        onSuccess: () => {
          toast.success("Redirecting to Google Sign-In...");
          setIsLoading(false);
          <Navigate to={"/"} />;
        },
        onError(error) {
          toast.error("Failed to initiate Google Sign-In. Please try again.");
          setIsLoading(false);
          console.error("Google Sign-In error:", error);
        },
      },
    );
  };
  return (
    <div className="flex justify-center items-center gap-4 mb-8">
      <Button
        className="w-full h-14 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-600 transition-all shadow-sm hover:-translate-y-1 bg-slate-100 dark:bg-slate-700"
        onClick={handleGoogleSignIn}
        disabled={isLoading}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-6 h-6 text-[#4285F4] fill-current"
        >
          <path d="M12.48 10.92v3.28h7.84c-.24 1.84-2.21 5.39-7.84 5.39-4.84 0-8.79-4.01-8.79-8.92s3.95-8.92 8.79-8.92c2.75 0 4.6 1.17 5.65 2.18l2.59-2.5c-1.66-1.55-3.82-2.5-8.24-2.5-6.63 0-12 5.37-12 12s5.37 12 12 12c6.92 0 11.52-4.87 11.52-11.72 0-.79-.08-1.39-.18-1.99h-11.34z" />
        </svg>
      </Button>
    </div>
  );
};

export default Socials;
