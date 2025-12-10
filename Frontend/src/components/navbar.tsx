import Login from './google-login';

export default function Navbar() {
    return (
        <>
            <nav className='flex justify-between items-center p-4'>
                <div className='flex gap-3 items-center'>
                    <h1 className='text-xl font-bold'>BookPilot</h1>  
                    <button className='rounded-2xl bg-green-800 py-1 px-2 text-white font-light'> Books</button>
                </div>
                <div>
                    <Login/>
                </div>
            </nav>
            <hr />
        </>
    )
}