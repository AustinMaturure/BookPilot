import { useNavigate } from 'react-router-dom';

type ComingSoonProps = {
  title: string;
};

export default function ComingSoon({ title }: ComingSoonProps) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#0a1a2e] flex items-center justify-center pt-20">
      <div className="text-center px-8">
        <h1 className="text-2xl font-bold text-white mb-2">{title}</h1>
        <p className="text-gray-400 text-xl mb-4">Coming soon in this prototype.</p>
        <button
          onClick={() => navigate('/')}
          className=" hover:bg-[#b8d04a] text-[#0a1a2e] font-semibold rounded-lg flex items-center gap-2 transition-colors mx-auto"
        >
          
          <span className='text-[#CDF056]'>Return Home</span>
        </button>
      </div>
    </div>
  );
}

