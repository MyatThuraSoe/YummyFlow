import Auth from "@/components/auth/Auth";
import type { Route } from "../+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Sign In" },
    { name: "description", content: "Welcome to the Sign In page" },
  ];
}

const SignInPage = () => {
  return <Auth />;
};

export default SignInPage;
