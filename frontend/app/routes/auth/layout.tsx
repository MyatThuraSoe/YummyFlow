import { authClient } from "@/lib/auth-client";
import { Navigate, Outlet } from "react-router";
import Wrapper from "@/components/auth/Wrapper";
import Loader from "@/components/global/Loader";
import toast from "react-hot-toast";

const AuthLayout = () => {
  const {
    data: session,
    isPending, //loading state
    error, //error object
    refetch, //refetch the session
  } = authClient.useSession();

  if (isPending) {
    return <Loader title="Loading user session..." className="min-h-screen" />;
  }

  if (error) {
    toast.error("Failed to load user session. Please try again.");
  }

  const navigateTo =
    session?.user.role === "ADMIN" || session?.user.role === "MANAGER"
      ? "/dashboard"
      : session?.user.role === "STAFF" || session?.user.role === "KITCHEN"
        ? "/pos/new-order"
        : "/";
  if (session?.session) {
    return <Navigate to={navigateTo} replace />;
  }
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Wrapper>
        <Outlet />
      </Wrapper>
    </div>
  );
};

export default AuthLayout;
