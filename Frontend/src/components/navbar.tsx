import Login from './login';

export default function Navbar() {
    return (
        <>
            <nav className='flex justify-between items-center p-4'>
                <h1 className='text-xl'>BookPilot</h1>
                <Login/>
            </nav>
            <hr />
        </>
    )
}