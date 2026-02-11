import { useEffect } from "react";
import { useLocation } from "wouter";

export default function VerifyWorkerPage() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/register");
  }, [setLocation]);

  return null;
}
