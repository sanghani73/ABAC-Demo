"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { Persona } from "@/lib/types";

interface Ctx {
  personas: Persona[];
  activeId: string;
  setActiveId: (id: string) => void;
  active: Persona | undefined;
}

const PersonaContext = createContext<Ctx | undefined>(undefined);

export default function PersonaProvider({ children }: { children: React.ReactNode }) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    fetch("/api/personas")
      .then((r) => r.json())
      .then((data) => {
        setPersonas(data.personas);
        const stored = typeof window !== "undefined" ? window.localStorage.getItem("personaId") : null;
        const initial = stored && data.personas.find((p: Persona) => p.id === stored)
          ? stored
          : data.personas[0]?.id ?? "";
        setActiveId(initial);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeId && typeof window !== "undefined") {
      window.localStorage.setItem("personaId", activeId);
    }
  }, [activeId]);

  const active = personas.find((p) => p.id === activeId);

  return (
    <PersonaContext.Provider value={{ personas, activeId, setActiveId, active }}>
      {children}
    </PersonaContext.Provider>
  );
}

export function usePersona() {
  const ctx = useContext(PersonaContext);
  if (!ctx) throw new Error("usePersona must be used inside PersonaProvider");
  return ctx;
}
