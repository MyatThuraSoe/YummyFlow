import { authClient } from "@/lib/auth-client";

import { Outlet, useLocation, useNavigate } from "react-router";
import { Navigate } from "react-router";
import Loader from "@/components/global/Loader";

const CustomerLayout = () => {
  const { data: session, isPending } = authClient.useSession();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  if (isPending) {
    return <Loader title="Loading User Session..." className="min-h-screen" />;
  }

  // Redirect if logged in
  if (!session) {
    return <Navigate to="/signin" replace />;
  }

  return (
    <main className="px-4 my-4">
      {/* <Header /> */}
      <Outlet />
    </main>
  );
};

export default CustomerLayout;
