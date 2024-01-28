import './styles.css'

export default function FAQ() {
  return (
    <article>

      <h1 className='text-logo-gradient'>
        Frequently Asked Questions
      </h1>

      <section>
        <h2>Does It Ranks the Instructors Themselves?</h2>
        <p>
          No, the website ranks instructors based on their teaching performance, not on the person themselves.
        </p>
      </section>

      <section>
        <h2>Where are the Data from? </h2>
        <p>
          The Data of the website is from another UST review website <a href='https://ust.space/'>UST.space</a>.
        </p>
      </section>

      <section>
        <h2>What are the Ranking Criteria? </h2>
        <p>
          The criteria of the ranking are:
        </p>
        <ol>
          <li>the ratings (of teaching) the instructor from the students;</li>
          <li>whether the instructor receives a "thumbs up" or "thumbs down" from the students;</li>
          <li>the number of reviews that are taken into consideration.</li>
        </ol>
      </section>

      <section>
        <h2>How are the Ratings & Scores Calculated? </h2>
        <p>
          First of all, the reviews are collected and preprocessed, including statistical techniques like
          standardization. Only the ratings and the semester that the review is posted are kept.
        </p>
        <p>
          Next, the ratings of each instructor are averaged by EWMA, so that the reviews posted recently will weight
          more than the ones posted early. I personally choose the smoothing factor to be <code>0.08425</code>, which
          makes the weightings of the last 2 years 50% of the whole.
        </p>
        <p>
          Now is the turn of comparing instructors. The ratings of teaching and the ratings of "thumbs up" are averaged
          to find the "overall" rating, and the numbers of reviews are taken into consideration in this step. Bayesian
          Average is adopted in this case. The final score is calculated by
          <pre>
            <code>((mn * mr) + (n * r)) / (mn + n)</code>
          </pre>
          where <code>mn, n</code> are the mean number of reviews and the number of reviews respectively; <code>mr,
          r</code> are the mean rating and the rating respectively. "Mean" here refers to the mean value among the
          instructors.
        </p>
        <p>
          The rankings are then calculated by the score. Hope you think this calculation is fair!
        </p>
      </section>

      <section>
        <h2>What is the Grading Scheme? </h2>
        <ul>
          <li>A range: 25%</li>
          <li>B range: 40%</li>
          <li>C range: 15%</li>
          <li>D range: 10%</li>
        </ul>
        <p>
          It is ever more lenient than most of the UST instructors!
        </p>
      </section>

      <section>
        <h2>Do You Think Ranking Instructors is Impolite?</h2>
        <p>
          No, as long as the result is objective.
        </p>
        <p>
          Subjective data, such as opinions, preferences, or feelings, can be quantified and analyzed using statistical
          methods. By collecting a large sample size and applying appropriate statistical techniques, we can identify
          trends, patterns, or relationships within the subjective data, which can lead to objective conclusions or
          insights.
        </p>
        <p>
          Moreover, the behavior of ranking is common. We have QS Rankings, Times Rankings, etc. for universities.
          Instructors rank students with A+, A, etc. by their performance in class. So, we rank instructors by their
          teaching performance. This is reasonable, isn't it?
        </p>
      </section>

    </article>
  );
}
