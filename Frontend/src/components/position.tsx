import { useState } from "react";

export default function Position() {
  const questions = [
    "Hi Alex! I'm your BookPilot coach. Let's start with the basics. What is the core topic you want to write about?",
    "That's interesting. Why does this topic matter to you personally?",
    "Got it. Now, who is your ideal reader? Be as specific as possible.",
    "What is the biggest challenge they are facing right now related to this?",
    "I see. What are the common misconceptions they have about this topic?",
    "Why haven't existing solutions worked for them so far?",
    "What is your unique approach or solution to this problem?",
    "If they could only take away one key insight from your book, what would it be?",
    "Let's move to structure. What are the 3-4 main sections of your book?",
    "Great start! I have enough to generate a preliminary outline. Ready to see it?"
  ];

  const [messages, setMessages] = useState([
    { from: "AI", text: questions[0] }
  ]);

  const [questionIndex, setQuestionIndex] = useState(1);
  const [userMessage, setUserMessage] = useState("");
  const [answers, setAnswers] = useState<
  { question: string; answer: string }[]
>([]);

  const sendMessage = () => {
    if (!userMessage.trim()) return;

    setAnswers((prev) => [
        ...prev,
        {
          question: questions[questionIndex - 1],  
          answer: userMessage
        }
      ]);

    const userBubble = { from: "user", text: userMessage };

    let newMessages = [...messages, userBubble];
    setUserMessage("");


    if (questionIndex < questions.length) {
      const aiBubble = { from: "AI", text: questions[questionIndex] };
      newMessages = [...newMessages, aiBubble];
      setQuestionIndex(questionIndex + 1);
    }

    setMessages(newMessages);
  };

  return (
    <section className="p-4">
      <div className="flex flex-col justify-between min-h-screen">

 
        <div className="flex flex-col gap-4 " id="bubble">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 ${
                msg.from === "user" ? "justify-end" : "justify-start"
              }`}
            >
        
              {msg.from === "AI" && (
                <div className="flex justify-center items-center rounded-full bg-black text-white w-8 h-8">
                  BP
                </div>
              )}

           
              <div
                className={`p-3 rounded-3xl max-w-[75%] ${
                  msg.from === "user"
                    ? "bg-blue-500 text-white rounded-br-none"
                    : "bg-gray-200 text-black rounded-bl-none"
                }`}
              >
                {msg.text}
              </div>

        
              {msg.from === "user" && (
                <div className="flex justify-center items-center rounded-full bg-blue-500 text-white w-8 h-8">
                  A
                </div>
              )}
            </div>
          ))} <div className="flex gap-2 absolute bottom-0 left-0 w-full p-4 bg-white border-t">
          <input
            type="text"
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            className="bg-gray-100 w-full p-2 rounded-md border"
            placeholder="Type your answer..."
          />
          <button
            onClick={sendMessage}
            className="bg-black text-white px-4 py-2 rounded-md"
          >
            Send
          </button>
        </div>
        </div>

       

      </div>
    </section>
  );
}
