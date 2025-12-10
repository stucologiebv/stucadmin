"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface FormData {
  firstname: string;
  email: string;
  phone: string;
  address: string;
  message: string;
}

function generateTransactionId(): string {
  return "tx-" + Date.now() + "-" + Math.random().toString(36).substring(2, 10);
}

export default function CTAForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [hasFormStarted, setHasFormStarted] = useState(false);
  const [transactionId] = useState(() => generateTransactionId());

  const [formData, setFormData] = useState<FormData>({
    firstname: "",
    email: "",
    phone: "",
    address: "",
    message: "",
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: "form_field_interaction",
      formName: "cta_form",
      fieldName: name,
      fieldValue: value,
    });
  };

  const handleFormFocus = () => {
    if (!hasFormStarted) {
      setHasFormStarted(true);
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: "form_start",
        formName: "cta_form",
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setResultMessage(null);

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: "generate_lead",
      transaction_id: transactionId,
      formName: "cta_form",
      ...formData,
    });

    try {
      const response = await fetch(
        "https://stucadmin.stucologie.nl/api/offerteaanvragen/website",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(formData),
        }
      );

      const data = await response.json();

      if (response.ok && data.success) {
        setFormData({
          firstname: "",
          email: "",
          phone: "",
          address: "",
          message: "",
        });
        setResultMessage("Bedankt! Uw aanvraag is succesvol verzonden. Wij nemen zo snel mogelijk contact met u op.");

        window.dataLayer.push({
          event: "form_success",
          transaction_id: transactionId,
          formName: "cta_form",
          ...formData,
        });
      } else {
        console.error("Form error:", data);
        setResultMessage(
          data.error || "Er is iets misgegaan bij het verzenden. Probeer het opnieuw."
        );

        window.dataLayer.push({
          event: "form_error",
          transaction_id: transactionId,
          formName: "cta_form",
          error: data.error || "Unknown error",
          ...formData,
        });
      }
    } catch (error: unknown) {
      console.error("Form submit error:", error);
      setResultMessage(
        "Er is een onverwachte fout opgetreden. Probeer het later opnieuw."
      );

      window.dataLayer.push({
        event: "form_error",
        transaction_id: transactionId,
        formName: "cta_form",
        error: error instanceof Error ? error.message : "Unknown network error",
        ...formData,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSuccess = resultMessage?.includes("succesvol");

  return (
    <section id="offerte" className="bg-gray-50 py-16 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-orange-500 to-orange-600 p-[1px] shadow-2xl">
          <div className="flex flex-col gap-10 bg-white/95 px-6 py-8 sm:px-10 sm:py-10 lg:flex-row lg:px-12 lg:py-12">
            <div className="space-y-5 lg:w-5/12">
              <span className="inline-flex items-center rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-orange-700">
                Binnen 24 uur reactie
              </span>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Vraag een vrijblijvende offerte aan
              </h2>
              <p className="text-base text-slate-600">
                Vul uw gegevens in en ontvang snel een persoonlijke,
                vrijblijvende offerte op maat voor uw stukadoorswerk.
              </p>
              <ul className="space-y-2 text-sm text-slate-600">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                  <span>
                    Altijd een transparante prijs, zonder verrassingen.
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                  <span>Advies op maat voor uw woning of project.</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                  <span>Vrijblijvend en kosteloos.</span>
                </li>
              </ul>
            </div>

            <div className="lg:w-7/12">
              <form
                onSubmit={handleSubmit}
                onFocus={handleFormFocus}
                className="space-y-6"
                aria-busy={isSubmitting}
              >
                <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
                  <div>
                    <Label
                      htmlFor="firstname"
                      className="text-sm font-medium text-slate-800"
                    >
                      Uw naam
                    </Label>
                    <Input
                      id="firstname"
                      name="firstname"
                      autoComplete="name"
                      required
                      placeholder="Uw naam"
                      value={formData.firstname}
                      onChange={handleChange}
                      className="mt-2 h-11 rounded-xl border border-orange-100 bg-white/90 text-sm text-slate-900 shadow-sm shadow-orange-900/5 transition placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-300"
                    />
                  </div>

                  <div>
                    <Label
                      htmlFor="email"
                      className="text-sm font-medium text-slate-800"
                    >
                      Email
                    </Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      placeholder="Uw e-mailadres"
                      value={formData.email}
                      onChange={handleChange}
                      className="mt-2 h-11 rounded-xl border border-orange-100 bg-white/90 text-sm text-slate-900 shadow-sm shadow-orange-900/5 transition placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-300"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
                  <div>
                    <Label
                      htmlFor="phone"
                      className="text-sm font-medium text-slate-800"
                    >
                      Telefoonnummer
                      <span className="ml-1 text-xs font-normal text-slate-400">
                        (optioneel)
                      </span>
                    </Label>
                    <Input
                      id="phone"
                      name="phone"
                      type="tel"
                      autoComplete="tel"
                      placeholder="Uw telefoonnummer"
                      value={formData.phone}
                      onChange={handleChange}
                      className="mt-2 h-11 rounded-xl border border-orange-100 bg-white/90 text-sm text-slate-900 shadow-sm shadow-orange-900/5 transition placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-300"
                    />
                  </div>

                  <div>
                    <Label
                      htmlFor="address"
                      className="text-sm font-medium text-slate-800"
                    >
                      Adres
                    </Label>
                    <Input
                      id="address"
                      name="address"
                      required
                      autoComplete="street-address"
                      placeholder="Straatnaam + huisnummer"
                      value={formData.address}
                      onChange={handleChange}
                      className="mt-2 h-11 rounded-xl border border-orange-100 bg-white/90 text-sm text-slate-900 shadow-sm shadow-orange-900/5 transition placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-300"
                    />
                  </div>
                </div>

                <div>
                  <Label
                    htmlFor="message"
                    className="text-sm font-medium text-slate-800"
                  >
                    Uw bericht
                  </Label>
                  <textarea
                    id="message"
                    name="message"
                    rows={4}
                    placeholder="Beschrijf uw project of vraag..."
                    value={formData.message}
                    onChange={handleChange}
                    className="mt-2 w-full resize-none rounded-xl border border-orange-100 bg-white/90 px-3 py-2 text-sm text-slate-900 shadow-sm shadow-orange-900/5 transition placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-300"
                  />
                </div>

                <div className="space-y-3">
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-orange-600 text-base font-semibold text-white shadow-lg shadow-orange-500/40 transition hover:translate-y-[1px] hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Verzenden...
                      </>
                    ) : (
                      <>
                        Offerte Aanvragen
                        <ArrowRight className="ml-2 h-5 w-5" />
                      </>
                    )}
                  </Button>
                  <p className="text-center text-xs text-slate-500">
                    100% vrijblijvend. Wij behandelen uw gegevens met zorg.
                  </p>
                </div>
              </form>

              {resultMessage && (
                <div
                  className={`mt-4 rounded-xl border p-4 text-sm ${
                    isSuccess
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-red-200 bg-red-50 text-red-800"
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  {resultMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus,
        input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0px 1000px #ffffff inset;
          box-shadow: 0 0 0px 1000px #ffffff inset;
          -webkit-text-fill-color: #0f172a !important;
          transition: background-color 5000s ease-in-out 0s;
        }
      `}</style>
    </section>
  );
}
