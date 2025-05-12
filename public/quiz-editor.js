document.addEventListener('DOMContentLoaded', () => {
    const quizForm = document.getElementById('quiz-form');
    const quizIdInput = document.getElementById('quiz-id');
    const quizNameInput = document.getElementById('quiz-name');
    const questionsContainer = document.getElementById('questions-container');
    const addQuestionBtn = document.getElementById('add-question-btn');
    const saveQuizBtn = document.getElementById('save-quiz-btn');
    const clearFormBtn = document.getElementById('clear-form-btn');
    const quizListUl = document.getElementById('quiz-list');
    const messageArea = document.getElementById('message-area');
    const refreshQuizzesBtn = document.getElementById('refresh-quizzes-btn');

    let questionCounter = 0; // Used to generate unique IDs for question elements

    function displayMessage(message, type = 'info', duration = 5000) {
        messageArea.textContent = message;
        messageArea.className = `message ${type} visible`;
        setTimeout(() => {
            messageArea.textContent = '';
            messageArea.className = 'message';
        }, duration);
    }

    function escapeHTML(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>"']/g, function (match) {
            return {
                '&': '&',
                '<': '<',
                '>': '>',
                '"': '"',
                "'": "'" 
            }[match];
        });
    }

    function createQuestionElement(qData = null, indexInQuiz = 0) {
        questionCounter++;
        const questionDiv = document.createElement('div');
        questionDiv.className = 'question-block';
        questionDiv.dataset.internalId = `qBlock${questionCounter}`;

        let questionText = '';
        let options = ['', '', '', ''];
        let correctAnswer = 0;

        if (qData) {
            questionText = qData.question || '';
            const providedOptions = Array.isArray(qData.options) ? qData.options : [];
            for (let i = 0; i < 4; i++) {
                options[i] = providedOptions[i] || '';
            }
            correctAnswer = (typeof qData.correctAnswer === 'number' && qData.correctAnswer >= 0 && qData.correctAnswer < 4) ? qData.correctAnswer : 0;
        }

        let optionsHTML = '';
        for (let i = 0; i < 4; i++) {
            const optValue = escapeHTML(options[i]);
            const isChecked = (i === correctAnswer) ? 'checked' : '';
            optionsHTML += `
                <div class="option-item">
                    <label for="qOpt${questionCounter}-${i}">Option ${i + 1}:</label>
                    <input type="text" id="qOpt${questionCounter}-${i}" class="option-input" value="${optValue}" required placeholder="Option ${i+1}">
                    <input type="radio" name="qCorrect${questionCounter}" id="qCorrect${questionCounter}-${i}" class="correct-answer-radio" value="${i}" ${isChecked} title="Mark as correct">
                    <label for="qCorrect${questionCounter}-${i}" class="radio-label">Correct</label>
                </div>
            `;
        }

        questionDiv.innerHTML = `
            <h4>Question <span class="question-number">${indexInQuiz + 1}</span></h4>
            <label for="qText${questionCounter}">Question Text:</label>
            <input type="text" id="qText${questionCounter}" class="question-text-input" value="${escapeHTML(questionText)}" required placeholder="Enter question">
            <div class="options-group">
                ${optionsHTML}
            </div>
            <button type="button" class="remove-question-btn" title="Remove this question">Remove Question</button>
        `;
        questionsContainer.appendChild(questionDiv);

        questionDiv.querySelector('.remove-question-btn').addEventListener('click', () => {
            questionDiv.remove();
            updateQuestionNumbers();
        });
    }

    function updateQuestionNumbers() {
        const questionBlocks = questionsContainer.querySelectorAll('.question-block');
        questionBlocks.forEach((block, index) => {
            const numSpan = block.querySelector('h4 .question-number');
            if (numSpan) numSpan.textContent = index + 1;
        });
    }

    function clearForm() {
        quizIdInput.value = '';
        quizNameInput.value = '';
        questionsContainer.innerHTML = '';
        questionCounter = 0;
        addQuestionBtn.click(); // Adds one empty question and updates numbers
        saveQuizBtn.textContent = 'Save Quiz';
        quizNameInput.focus();
    }

    async function fetchQuizzes() {
        quizListUl.innerHTML = '<li>Loading quizzes...</li>';
        try {
            const response = await fetch('/api/quizzes');
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
                throw new Error(errorData.message || `Server error: ${response.status}`);
            }
            const quizzes = await response.json();
            renderQuizList(quizzes);
        } catch (error) {
            console.error('Error fetching quizzes:', error);
            displayMessage(`Failed to load quizzes: ${error.message}`, 'error');
            quizListUl.innerHTML = '<li>Failed to load quizzes. Please try refreshing.</li>';
        }
    }

    function renderQuizList(quizzes) {
        quizListUl.innerHTML = '';
        if (!quizzes || quizzes.length === 0) {
            quizListUl.innerHTML = '<li>No quizzes found. Create one!</li>';
            return;
        }
        quizzes.forEach(quiz => {
            const li = document.createElement('li');
            const quizDataLength = (quiz.data && Array.isArray(quiz.data)) ? quiz.data.length : 0;
            li.innerHTML = `
                <span class="quiz-name-list">${escapeHTML(quiz.name)}</span>
                <span class="quiz-details-list">(${quizDataLength} question${quizDataLength !== 1 ? 's' : ''})</span>
                <div class="quiz-actions-list">
                    <button class="edit-btn action-btn" data-id="${quiz._id}" title="Edit this quiz">Edit</button>
                    <button class="delete-btn action-btn" data-id="${quiz._id}" title="Delete this quiz">Delete</button>
                </div>
            `;
            quizListUl.appendChild(li);

            li.querySelector('.edit-btn').addEventListener('click', () => loadQuizForEditing(quiz));
            li.querySelector('.delete-btn').addEventListener('click', () => deleteQuiz(quiz._id, quiz.name));
        });
    }

    function loadQuizForEditing(quiz) {
        questionsContainer.innerHTML = ''; // Clear existing questions before loading new ones
        questionCounter = 0; 

        quizIdInput.value = quiz._id;
        quizNameInput.value = quiz.name;
        saveQuizBtn.textContent = 'Update Quiz';

        if (quiz.data && quiz.data.length > 0) {
            quiz.data.forEach((qData, index) => {
                createQuestionElement(qData, index);
            });
        } else {
            // If quiz has no questions, add one empty block for editing
            createQuestionElement(null, 0);
        }
        updateQuestionNumbers(); // Make sure numbers are correct after loading
        window.scrollTo(0, 0);
        displayMessage(`Editing quiz: "${escapeHTML(quiz.name)}"`, 'info', 3000);
    }

    async function deleteQuiz(id, name) {
        if (!confirm(`Are you sure you want to delete the quiz "${escapeHTML(name)}"? This action cannot be undone.`)) return;

        try {
            const response = await fetch(`/api/quizzes/${id}`, { method: 'DELETE' });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
                throw new Error(errorData.message || `Server error: ${response.status}`);
            }
            displayMessage(`Quiz "${escapeHTML(name)}" deleted successfully.`, 'success');
            if (quizIdInput.value === id) { // If the deleted quiz was being edited
                clearForm();
            }
            fetchQuizzes(); // Refresh list
        } catch (error) {
            console.error('Error deleting quiz:', error);
            displayMessage(`Error deleting quiz: ${error.message}`, 'error');
        }
    }

    addQuestionBtn.addEventListener('click', () => {
        const currentQuestionCount = questionsContainer.children.length;
        createQuestionElement(null, currentQuestionCount);
        // updateQuestionNumbers(); // createQuestionElement handles numbering
    });

    clearFormBtn.addEventListener('click', () => {
        // Check if there's anything to clear
        let isFormDirty = false;
        if (quizIdInput.value || quizNameInput.value.trim() !== '') {
            isFormDirty = true;
        } else if (questionsContainer.children.length > 1) {
            isFormDirty = true;
        } else if (questionsContainer.children.length === 1) {
            const firstQuestionBlock = questionsContainer.children[0];
            if (firstQuestionBlock.querySelector('.question-text-input').value.trim() !== '') isFormDirty = true;
            Array.from(firstQuestionBlock.querySelectorAll('.option-input')).forEach(input => {
                if (input.value.trim() !== '') isFormDirty = true;
            });
        }

        if (isFormDirty) {
            if (confirm("Are you sure you want to clear the form? Any unsaved changes will be lost.")) {
                clearForm();
                displayMessage('Form cleared. Ready for a new quiz.', 'info');
            }
        } else {
            clearForm(); // If form is already empty, just reset to one blank question
        }
    });

    quizForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const quizName = quizNameInput.value.trim();
        if (!quizName) {
            displayMessage('Quiz name is required.', 'error');
            quizNameInput.focus();
            return;
        }

        const quizPayload = {
            name: quizName,
            data: []
        };

        const questionBlocks = questionsContainer.querySelectorAll('.question-block');
        if (questionBlocks.length === 0) {
            displayMessage('A quiz must have at least one question. Please add a question.', 'error');
            addQuestionBtn.focus();
            return;
        }

        for (let i = 0; i < questionBlocks.length; i++) {
            const block = questionBlocks[i];
            const questionText = block.querySelector('.question-text-input').value.trim();
            const optionInputs = block.querySelectorAll('.option-input');
            const options = Array.from(optionInputs).map(input => input.value.trim());
            const correctAnswerRadio = block.querySelector('.correct-answer-radio:checked');

            if (!questionText) {
                displayMessage(`Question ${i + 1} text is required.`, 'error');
                block.querySelector('.question-text-input').focus();
                return;
            }
            if (options.some(opt => !opt)) {
                displayMessage(`All 4 options for question ${i + 1} are required.`, 'error');
                const firstEmptyOption = Array.from(optionInputs).find(opt => !opt.value.trim());
                if(firstEmptyOption) firstEmptyOption.focus();
                return;
            }
            if (!correctAnswerRadio) {
                displayMessage(`A correct answer must be selected for question ${i + 1}.`, 'error');
                const firstRadio = block.querySelector('.correct-answer-radio');
                if (firstRadio) firstRadio.focus();
                return;
            }

            quizPayload.data.push({
                question: questionText,
                options: options,
                correctAnswer: parseInt(correctAnswerRadio.value)
            });
        }

        const id = quizIdInput.value;
        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/quizzes/${id}` : '/api/quizzes';

        saveQuizBtn.disabled = true;
        saveQuizBtn.textContent = id ? 'Updating...' : 'Saving...';

        try {
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(quizPayload)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || `HTTP error! Status: ${response.status}`);
            }
            
            displayMessage(result.message || `Quiz ${id ? 'updated' : 'created'} successfully!`, 'success');
            
            if (!id || method === 'POST') {
                 clearForm(); 
            } else {
                saveQuizBtn.textContent = 'Update Quiz';
                const updatedQuizData = await fetch(`/api/quizzes/${id}`).then(res => res.json());
                loadQuizForEditing(updatedQuizData);
            }
            fetchQuizzes(); // Refresh the list

        } catch (error) {
            console.error('Error saving quiz:', error);
            displayMessage(`Error saving quiz: ${error.message}`, 'error');
            saveQuizBtn.textContent = id ? 'Update Quiz' : 'Save Quiz';
        } finally {
            saveQuizBtn.disabled = false;
        }
    });
    
    if(refreshQuizzesBtn) {
        refreshQuizzesBtn.addEventListener('click', fetchQuizzes);
    }

    // Initial Load:
    clearForm(); 
    fetchQuizzes(); // Load existing quizzes
});