import { motion } from "motion/react";
import { Utensils, Zap, BarChart3, Table as TableIcon } from "lucide-react";

const Wrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-6xl bg-white dark:bg-slate-900 rounded-xl overflow-hidden shadow-2xl flex flex-col md:flex-row min-h-187.5 border border-slate-100 dark:border-slate-800"
    >
      {children}
      {/* simple design generated using ai */}
      {/* Right Side - Visual */}
      <div className="hidden md:block flex-1 relative p-3">
        <div className="w-full h-full rounded-xl overflow-hidden relative">
          <img
            src="https://images.unsplash.com/photo-1552566626-52f8b828add9?q=80&w=2070&auto=format&fit=crop"
            alt="Restaurant Interior"
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-linear-to-br from-black/40 via-black/20 to-transparent" />

          {/* Top Right Card */}
          <div className="absolute top-8 right-8 w-56 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md p-6 rounded-[2rem] shadow-2xl border border-white/20 dark:border-slate-800/50">
            <div className="text-3xl font-black text-slate-900 dark:text-white mb-1">
              2,500+
            </div>
            <div className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest leading-tight mb-4">
              Restaurants trust <br /> DineFlow daily
            </div>
            <div className="flex -space-x-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="w-8 h-8 rounded-full border-2 border-white dark:border-slate-800 overflow-hidden"
                >
                  <img
                    src={`https://i.pravatar.cc/100?img=${i + 10}`}
                    alt="User"
                  />
                </div>
              ))}
              <div className="w-8 h-8 rounded-full border-2 border-white dark:border-slate-800 bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-400">
                +1k
              </div>
            </div>
          </div>

          {/* Logo Overlay */}
          <div className="absolute top-12 left-12 flex items-center gap-3 text-white group">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center group-hover:rotate-12 transition-transform">
              <Utensils className="text-white w-6 h-6" />
            </div>
            <span className="text-2xl font-black tracking-tighter">
              DineFlow
            </span>
          </div>

          {/* Center Text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-12 text-white mt-32">
            <h2 className="text-4xl font-black tracking-tight mb-4 leading-none">
              Efficiency <br /> Meets Elegance
            </h2>
            <p className="text-sm font-medium opacity-90 leading-relaxed max-w-xs">
              Manage your entire restaurant ecosystem from a single, beautiful
              interface.
            </p>
          </div>

          {/* Bottom Tags */}
          <div className="absolute bottom-12 left-0 right-0 flex flex-wrap justify-center gap-3 px-8">
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-xl border border-white/10 px-5 py-2.5 rounded-2xl text-white text-[10px] font-black uppercase tracking-widest">
              <div className="w-6 h-6 bg-primary rounded-lg flex items-center justify-center">
                <Zap size={12} />
              </div>
              Fast_Sync
            </div>
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-xl border border-white/10 px-5 py-2.5 rounded-2xl text-white text-[10px] font-black uppercase tracking-widest">
              <div className="w-6 h-6 bg-emerald-500 rounded-lg flex items-center justify-center">
                <TableIcon size={12} />
              </div>
              Live_Floor
            </div>
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-xl border border-white/10 px-5 py-2.5 rounded-2xl text-white text-[10px] font-black uppercase tracking-widest">
              <div className="w-6 h-6 bg-blue-500 rounded-lg flex items-center justify-center">
                <BarChart3 size={12} />
              </div>
              AI_Insights
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default Wrapper;
