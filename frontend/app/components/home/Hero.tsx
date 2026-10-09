import { Link } from "react-router";
import Header from "./Header";

const Hero = () => {
  // design generate by ai except a few changes by me
  return (
    <div className="min-h-screen bg-nova-paper dark:bg-slate-950 font-sans selection:bg-primary/30 transition-colors duration-500">
      <div className="relative min-h-[calc(100vh-1.5rem)] rounded-xl overflow-hidden bg-linear-to-br from-[#fbd6cb] via-[#f4401c] to-primary dark:from-slate-900 dark:via-primary/20 dark:to-slate-950 transition-all duration-700">
        {/* Halftone Dotted Pattern Overlay */}
        <div
          className="absolute inset-0 opacity-20 dark:opacity-20 pointer-events-none 
             [--dot-color:#241006] dark:[--dot-color:#ffffff]"
          style={{
            backgroundImage:
              "radial-gradient(var(--dot-color) 2px, transparent 2px)",
            backgroundSize: "24px 24px",
            maskImage: "linear-gradient(to bottom, transparent, black 60%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent, black 60%)",
          }}
        />
        <Header />
        {/* Hero Section */}
        <section className="relative z-10 max-w-[80%] mx-auto px-8 lg:px-12 flex flex-col lg:flex-row items-center min-h-[80vh] pt-12 lg:pt-0">
          {/* Text Content */}
          <div className="w-full lg:max-w-2xl space-y-8 text-center lg:text-left z-20">
            <div>
              <h1 className="text-5xl md:text-8xl font-black tracking-tighter leading-[0.85] text-[#241006] dark:text-white uppercase">
                FUEL{" "}
                <span className="text-luxury text-white dark:text-primary lowercase">
                  Your day
                </span>{" "}
                <br />
                the <span className="text-luxury lowercase">healthy</span> way
              </h1>
              <p className="mt-8 text-lg md:text-xl text-[#241006]/80 dark:text-white/80 max-w-md mx-auto lg:mx-0 leading-relaxed font-medium">
                Discover our customizable salads and bowls made from the
                freshest ingredients, sourced from local farms.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4">
              <Link
                to="/#items"
                className="bg-[#241006] dark:bg-white text-white dark:text-primary px-10 py-5 rounded-full font-black text-sm uppercase tracking-widest hover:scale-105 transition-all shadow-2xl shadow-black/20"
              >
                Order Food
              </Link>
              <Link
                to="/reservation"
                className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md text-[#241006] dark:text-white border border-white/20 px-10 py-5 rounded-full font-black text-sm uppercase tracking-widest hover:bg-white transition-all shadow-lg"
              >
                Make Reservation
              </Link>
            </div>
          </div>

          {/* Hero Image Container */}
          <div className="relative w-[120%] left-[10%] mt-8 lg:absolute lg:right-[-14%] lg:bottom-[-5%] lg:left-auto lg:w-[70%] lg:mt-0 pointer-events-none z-10">
            <img
              src="/hero.png"
              alt="Healthy Food Tray"
              className="w-full h-auto object-contain drop-shadow-[0_35px_35px_rgba(0,0,0,0.25)]"
            />
          </div>
        </section>
      </div>
    </div>
  );
};

export default Hero;
